export type CheckItId = "message" | "link" | "file" | "call" | "scan" | "email" | "app" | "account" | "device" | "network";

export type CheckItRoute = "/message" | "/check" | "/file" | "/call" | "/scan" | "/email" | "/app-check" | "/account" | "/device" | "/network";

export type CheckItIcon = "message" | "link" | "file" | "call" | "scan" | "email" | "app" | "account" | "device" | "network";
export type AcceptedIntake = "text" | "url" | "file" | "image" | "native_observation" | "user_context";

export interface CheckItItem {
  id: CheckItId;
  label: string;
  purpose: string;
  route: CheckItRoute;
  icon: CheckItIcon;
  acceptedIntake: readonly AcceptedIntake[];
}

export const CHECK_IT_ITEMS = [
  { id: "message", label: "Check a message", purpose: "Paste, share or add a screenshot of a message that worries you.", route: "/message", icon: "message", acceptedIntake: ["text", "image"] },
  { id: "link", label: "Check a link", purpose: "See where a link leads before you open it.", route: "/check", icon: "link", acceptedIntake: ["url"] },
  { id: "file", label: "Check a file", purpose: "Choose or share a download or attachment for Apollo to examine.", route: "/file", icon: "file", acceptedIntake: ["file"] },
  { id: "call", label: "Check a call or number", purpose: "Check a caller, phone number or something said during a call.", route: "/call", icon: "call", acceptedIntake: ["text", "user_context"] },
  { id: "scan", label: "Scan a code", purpose: "Scan a QR code or barcode and check what it contains.", route: "/scan", icon: "scan", acceptedIntake: ["image", "url", "text"] },
  { id: "email", label: "Check an email", purpose: "Paste or share an email, or use your connected Gmail inbox.", route: "/email", icon: "email", acceptedIntake: ["text", "file", "url"] },
  { id: "app", label: "Check an app", purpose: "Review an installed app or one you are thinking of installing.", route: "/app-check", icon: "app", acceptedIntake: ["native_observation", "user_context"] },
  { id: "account", label: "Check an account alert", purpose: "Review a login, breach or recovery warning without sharing passwords or codes.", route: "/account", icon: "account", acceptedIntake: ["text", "image", "user_context"] },
  { id: "device", label: "Check my device", purpose: "Review important protection, permission and device changes.", route: "/device", icon: "device", acceptedIntake: ["native_observation", "user_context"] },
  { id: "network", label: "Check my network", purpose: "Review the connection facts this device can see and describe your concern.", route: "/network", icon: "network", acceptedIntake: ["native_observation", "user_context"] },
] as const satisfies readonly CheckItItem[];

export function checkItItem(id: CheckItId): CheckItItem {
  const item = CHECK_IT_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Unknown Apollo check destination");
  return item;
}