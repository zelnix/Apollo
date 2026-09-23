#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fwpmu.h>
#include <ws2tcpip.h>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#pragma comment(lib, "fwpuclnt.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "advapi32.lib")

#ifdef __MINGW32__
// Well-known WFP keys are declared by the Microsoft SDK but omitted by MinGW's generated header.
const GUID FWPM_LAYER_ALE_AUTH_CONNECT_V4 = {0xc38d57d1, 0x05a7, 0x4c33, {0x90, 0x4f, 0x7f, 0xbc, 0xee, 0xe6, 0x0e, 0x82}};
const GUID FWPM_LAYER_ALE_AUTH_CONNECT_V6 = {0x4a72393b, 0x319f, 0x44bc, {0x84, 0xc3, 0xba, 0x54, 0xdc, 0xb3, 0xb6, 0xb4}};
const GUID FWPM_CONDITION_IP_REMOTE_ADDRESS = {0xb235ae9a, 0x1d64, 0x49b8, {0xa4, 0x4c, 0x5f, 0xf3, 0xd9, 0x09, 0x50, 0x45}};
#ifndef FWPM_SESSION_FLAG_DYNAMIC
#define FWPM_SESSION_FLAG_DYNAMIC 0x00000001
#endif
#endif

namespace {
constexpr wchar_t kServiceName[] = L"ApolloProtectionService";
// Stable Apollo-owned sublayer identifier. Filters are dynamic and disappear if the service dies.
const GUID kApolloSublayer = {0xa1f102c7, 0xd85e, 0x4a22, {0x9d, 0x3a, 0xd2, 0xf7, 0xb3, 0x6b, 0x77, 0x20}};
SERVICE_STATUS_HANDLE statusHandle{};
SERVICE_STATUS serviceStatus{};
HANDLE stopEvent{};
std::mutex evidenceMutex;
std::set<UINT64> filterIds;
std::unordered_map<UINT64, std::wstring> filterDomains;

std::filesystem::path programData() {
  wchar_t value[MAX_PATH]{};
  DWORD size = GetEnvironmentVariableW(L"ProgramData", value, MAX_PATH);
  return std::filesystem::path(size ? value : L"C:\\ProgramData") / L"Apollo";
}

std::set<std::wstring> loadRules() {
  std::set<std::wstring> values;
  std::wifstream stream(programData() / L"rules.txt");
  std::wstring line;
  while (std::getline(stream, line)) {
    if (line.empty() || line[0] == L'#' || line.size() > 253) continue;
    if (line.find_first_not_of(L"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:") == std::wstring::npos) values.insert(line);
  }
  return values;
}

void writeStatus(const wchar_t* state, const wchar_t* detail) {
  std::error_code ignored;
  std::filesystem::create_directories(programData(), ignored);
  std::wofstream out(programData() / L"filter-status.json", std::ios::trunc);
  out << L"{\"state\":\"" << state << L"\",\"mechanism\":\"wfp_ale_authorization\",\"detail\":\"" << detail << L"\"}";
}

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  int count = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(count), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), count, nullptr, nullptr);
  return result;
}

std::string escaped(std::string value) {
  std::string result;
  for (char ch : value) { if (ch == '\\' || ch == '"') result.push_back('\\'); if (ch != '\r' && ch != '\n') result.push_back(ch); }
  return result;
}

std::string nowIso() {
  SYSTEMTIME t{}; GetSystemTime(&t);
  char value[32]{};
  snprintf(value, sizeof(value), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
  return value;
}

void pruneEvidence(const std::filesystem::path& directory) {
  std::vector<std::filesystem::path> files;
  std::error_code ignored;
  for (const auto& entry : std::filesystem::directory_iterator(directory, ignored)) {
    if (entry.is_regular_file() && entry.path().extension() == L".json") files.push_back(entry.path());
  }
  std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
    std::error_code leftError, rightError;
    return std::filesystem::last_write_time(a, leftError) < std::filesystem::last_write_time(b, rightError);
  });
  while (files.size() >= 256) { std::filesystem::remove(files.front(), ignored); files.erase(files.begin()); }
}

void CALLBACK onNetEvent(void*, const FWPM_NET_EVENT1* event) {
  if (!event || event->type != FWPM_NET_EVENT_TYPE_CLASSIFY_DROP || !event->classifyDrop) return;
  std::wstring matchedDomain;
  {
    std::lock_guard lock(evidenceMutex);
    if (!filterIds.contains(event->classifyDrop->filterId)) return;
    const auto found = filterDomains.find(event->classifyDrop->filterId);
    if (found == filterDomains.end()) return;
    matchedDomain = found->second;
  }
  std::wstring app;
  if (event->header.appId.data && event->header.appId.size) {
    app.assign(reinterpret_cast<const wchar_t*>(event->header.appId.data), event->header.appId.size / sizeof(wchar_t));
    while (!app.empty() && app.back() == L'\0') app.pop_back();
  }
  if (app.size() > 128) app.resize(128);
  wchar_t remote[INET6_ADDRSTRLEN]{};
  if (event->header.ipVersion == FWP_IP_VERSION_V4) {
    IN_ADDR address{}; address.S_un.S_addr = htonl(event->header.remoteAddrV4); InetNtopW(AF_INET, &address, remote, INET6_ADDRSTRLEN);
  } else {
    IN6_ADDR address{}; memcpy(&address, event->header.remoteAddrV6.byteArray16, 16); InetNtopW(AF_INET6, &address, remote, INET6_ADDRSTRLEN);
  }
  GUID id{}; CoCreateGuid(&id);
  wchar_t idText[40]{}; StringFromGUID2(id, idText, 40);
  std::wstring process = app.empty() ? L"" : std::filesystem::path(app).filename().wstring();
  if (process.size() > 128) process.resize(128);
  std::wstring evidenceId(idText);
  if (evidenceId.size() > 1 && evidenceId.front() == L'{' && evidenceId.back() == L'}') evidenceId = evidenceId.substr(1, evidenceId.size() - 2);
  const char* protocol = event->header.ipProtocol == IPPROTO_TCP ? "tcp" : event->header.ipProtocol == IPPROTO_UDP ? "udp" : "unknown";
  std::error_code ignored; auto directory = programData() / L"evidence"; std::filesystem::create_directories(directory, ignored);
  pruneEvidence(directory);
  std::ofstream out(directory / (evidenceId + L".json"), std::ios::trunc);
  out << "{\"evidenceId\":\"" << escaped(utf8(evidenceId)) << "\",\"eventId\":null,\"deviceId\":null,\"platform\":\"windows\","
      << "\"osVersion\":\"observed-by-wfp\",\"sdkVersion\":\"1.1.0\",\"observedAt\":\"" << nowIso() << "\","
      << "\"mechanism\":\"wfp_ale_authorization\",\"direction\":\"outbound\",\"protocol\":\"" << protocol << "\","
      << "\"destination\":{\"ip\":\"" << escaped(utf8(remote)) << "\",\"domain\":\"" << escaped(utf8(matchedDomain)) << "\",\"port\":" << event->header.remotePort << "},"
      << "\"attribution\":{\"appId\":\"" << escaped(utf8(app)) << "\",\"processName\":\"" << escaped(utf8(process)) << "\",\"confidence\":\"high\"},"
      << "\"matchedRuleId\":\"wfp-filter-" << event->classifyDrop->filterId << "\",\"threatId\":null,\"requestedAction\":\"block\",\"enforcedAction\":\"blocked\","
      << "\"result\":\"verified\",\"ruleSource\":\"local_blocklist\",\"confidence\":\"high\",\"sourceMetadata\":{\"provider\":\"Windows Filtering Platform\"},\"correlationId\":null}";
}

DWORD addRemoteAddressFilter(HANDLE engine, const GUID& layer, const SOCKADDR* address, UINT32 index, const std::wstring& rule) {
  FWPM_FILTER_CONDITION0 condition{};
  condition.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
  condition.matchType = FWP_MATCH_EQUAL;
  FWP_BYTE_ARRAY16 ipv6{};
  if (address->sa_family == AF_INET) {
    condition.conditionValue.type = FWP_UINT32;
    condition.conditionValue.uint32 = ntohl(reinterpret_cast<const SOCKADDR_IN*>(address)->sin_addr.S_un.S_addr);
  } else {
    condition.conditionValue.type = FWP_BYTE_ARRAY16_TYPE;
    memcpy(ipv6.byteArray16, &reinterpret_cast<const SOCKADDR_IN6*>(address)->sin6_addr, 16);
    condition.conditionValue.byteArray16 = &ipv6;
  }
  FWPM_FILTER0 filter{};
  std::wstring name = L"Apollo blocked destination " + std::to_wstring(index);
  filter.displayData.name = name.data();
  filter.layerKey = layer;
  filter.subLayerKey = kApolloSublayer;
  filter.weight.type = FWP_EMPTY;
  filter.action.type = FWP_ACTION_BLOCK;
  filter.numFilterConditions = 1;
  filter.filterCondition = &condition;
  UINT64 id{};
  DWORD code = FwpmFilterAdd0(engine, &filter, nullptr, &id);
  if (code == ERROR_SUCCESS) { std::lock_guard lock(evidenceMutex); filterIds.insert(id); filterDomains[id] = rule; }
  return code;
}

DWORD installRules(HANDLE engine) {
  FWPM_SUBLAYER0 sublayer{};
  sublayer.subLayerKey = kApolloSublayer;
  sublayer.displayData.name = const_cast<wchar_t*>(L"Apollo protection");
  sublayer.displayData.description = const_cast<wchar_t*>(L"Apollo exact-destination outbound protection");
  sublayer.weight = 0x5000;
  DWORD code = FwpmSubLayerAdd0(engine, &sublayer, nullptr);
  if (code != ERROR_SUCCESS && code != FWP_E_ALREADY_EXISTS) return code;

  UINT32 index = 0;
  for (const auto& rule : loadRules()) {
    ADDRINFOW hints{}; hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
    ADDRINFOW* result{};
    if (GetAddrInfoW(rule.c_str(), nullptr, &hints, &result) != 0) continue;
    for (ADDRINFOW* item = result; item; item = item->ai_next) {
      const GUID& layer = item->ai_family == AF_INET ? FWPM_LAYER_ALE_AUTH_CONNECT_V4 : FWPM_LAYER_ALE_AUTH_CONNECT_V6;
      code = addRemoteAddressFilter(engine, layer, item->ai_addr, index++, rule);
      if (code != ERROR_SUCCESS) break;
    }
    FreeAddrInfoW(result);
    if (code != ERROR_SUCCESS) return code;
  }
  return ERROR_SUCCESS;
}

void WINAPI control(DWORD value) {
  if (value == SERVICE_CONTROL_STOP && stopEvent) SetEvent(stopEvent);
}

void WINAPI serviceMain(DWORD, wchar_t**) {
  statusHandle = RegisterServiceCtrlHandlerW(kServiceName, control);
  serviceStatus = {SERVICE_WIN32_OWN_PROCESS, SERVICE_START_PENDING, 0, NO_ERROR, 0, 0, 0};
  SetServiceStatus(statusHandle, &serviceStatus);
  stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

  FWPM_SESSION0 session{};
  session.flags = FWPM_SESSION_FLAG_DYNAMIC;
  session.displayData.name = const_cast<wchar_t*>(L"Apollo protection service");
  HANDLE engine{};
  DWORD code = FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session, &engine);
  if (code == ERROR_SUCCESS) {
    FWP_VALUE0 collect{}; collect.type = FWP_UINT32; collect.uint32 = 1; FwpmEngineSetOption0(engine, FWPM_ENGINE_COLLECT_NET_EVENTS, &collect);
    code = installRules(engine);
  }
  if (code != ERROR_SUCCESS) {
    writeStatus(L"adapter_failed", L"Windows Filtering Platform could not be started");
    serviceStatus.dwCurrentState = SERVICE_STOPPED; serviceStatus.dwWin32ExitCode = code; SetServiceStatus(statusHandle, &serviceStatus); return;
  }

  writeStatus(L"active", L"Outbound IPv4 and IPv6 authorization filters are active");
  serviceStatus.dwCurrentState = SERVICE_RUNNING; serviceStatus.dwControlsAccepted = SERVICE_ACCEPT_STOP; SetServiceStatus(statusHandle, &serviceStatus);
  HANDLE subscription{};
  FWPM_NET_EVENT_SUBSCRIPTION0 subscriptionOptions{};
  FwpmNetEventSubscribe0(engine, &subscriptionOptions, onNetEvent, nullptr, &subscription);
  bool refreshFailed = false;
  while (WaitForSingleObject(stopEvent, 5000) == WAIT_TIMEOUT) {
    if (subscription) { FwpmNetEventUnsubscribe0(engine, subscription); subscription = nullptr; }
    FwpmEngineClose0(engine); engine = nullptr;
    { std::lock_guard lock(evidenceMutex); filterIds.clear(); filterDomains.clear(); }
    code = FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session, &engine);
    if (code != ERROR_SUCCESS || installRules(engine) != ERROR_SUCCESS) { refreshFailed = true; writeStatus(L"adapter_failed", L"Windows Filtering Platform rules could not be refreshed"); break; }
    FWP_VALUE0 collect{}; collect.type = FWP_UINT32; collect.uint32 = 1; FwpmEngineSetOption0(engine, FWPM_ENGINE_COLLECT_NET_EVENTS, &collect);
    FwpmNetEventSubscribe0(engine, &subscriptionOptions, onNetEvent, nullptr, &subscription);
  }
  if (subscription && engine) FwpmNetEventUnsubscribe0(engine, subscription);
  if (engine) FwpmEngineClose0(engine);
  if (!refreshFailed) writeStatus(L"stopped", L"The Windows filtering service is stopped");
  serviceStatus.dwCurrentState = SERVICE_STOPPED; serviceStatus.dwControlsAccepted = 0; serviceStatus.dwWin32ExitCode = refreshFailed ? ERROR_SERVICE_SPECIFIC_ERROR : NO_ERROR; SetServiceStatus(statusHandle, &serviceStatus);
}
} // namespace

int wmain() {
  SERVICE_TABLE_ENTRYW table[] = {{const_cast<wchar_t*>(kServiceName), serviceMain}, {nullptr, nullptr}};
  return StartServiceCtrlDispatcherW(table) ? 0 : static_cast<int>(GetLastError());
}