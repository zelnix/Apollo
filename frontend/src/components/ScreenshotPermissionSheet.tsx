import { Body, Button } from "@/src/components/ui";
import { Sheet } from "@/src/components/Sheet";

interface Props {
  prefix: string;
  visible: boolean;
  canAskAgain: boolean;
  checking: boolean;
  onContinue: () => void;
  onClose: () => void;
}

export function ScreenshotPermissionSheet({ prefix, visible, canAskAgain, checking, onContinue, onClose }: Props) {
  return <Sheet visible={visible} onClose={onClose} title="Choose a screenshot" testID={`${prefix}-photo-permission-sheet`}>
    <Body testID={`${prefix}-photo-permission-why`}>Apollo needs photo access only so you can choose the screenshot you want investigated. It cannot browse your library in the background.</Body>
    <Body testID={`${prefix}-photo-permission-secrets`}>Before choosing, crop or cover any password, login username, PIN, recovery code or one-time security code. Apollo redacts secret text it can identify and never stores it.</Body>
    <Body testID={`${prefix}-photo-permission-status`}>{canAskAgain
      ? "Your phone will ask for access next. You can choose limited access and select only this screenshot."
      : "Photo access is off. Open Settings, allow photo access for Apollo, then return — Apollo will check again automatically."}</Body>
    <Button testID={`${prefix}-photo-permission-continue`} label={checking ? "Checking…" : canAskAgain ? "Continue" : "Open Settings"} onPress={onContinue} disabled={checking} />
    <Button testID={`${prefix}-photo-permission-cancel`} variant="ghost" label="Not now" onPress={onClose} />
  </Sheet>;
}