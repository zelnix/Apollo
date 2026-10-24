// Google Play restricted pickers (READ_CALL_LOG / READ_SMS): has this build declared one?
// The answer comes from expo extra.restrictedPhonePermissions, written by app.config.js from the same
// switch plugins/withRestrictedPhonePermissions.js uses for the manifest. Only a literal `true` counts.
export type RestrictedPicker = "call_log" | "sms";

export function restrictedPickerDeclared(name: RestrictedPicker, extra: unknown): boolean {
  const flags = (extra as { restrictedPhonePermissions?: { callLog?: unknown; sms?: unknown } } | null | undefined)?.restrictedPhonePermissions;
  return (name === "call_log" ? flags?.callLog : flags?.sms) === true;
}
