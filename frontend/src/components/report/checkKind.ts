// The kind of check a report is about, with its icon — the same title on Ask Higgins and a threat's Overview.
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import Smartphone from "lucide-react-native/icons/smartphone";
import type React from "react";

export interface CheckKind { title: string; Icon: React.ComponentType<{ size: number; color: string }>; iconBg: string; iconColor: string }

const BLUE = { iconBg: "#DBEAFE", iconColor: "#1E3A5F" };

/** From an investigation's gate ("text", "link", …) or a threat's category ("message", "website", …). */
export function checkKind(kind: string | null | undefined): CheckKind {
  switch (kind) {
    case "text": case "message": case "sms": return { title: "Message check", Icon: MessageSquare, iconBg: "rgba(212,120,10,0.15)", iconColor: "#D4780A" };
    case "call": return { title: "Call check", Icon: Phone, ...BLUE };
    case "email": return { title: "Email check", Icon: Mail, ...BLUE };
    case "site": case "link": case "website": case "url": return { title: "Website check", Icon: Globe, ...BLUE };
    case "file": case "screenshot": return { title: "File check", Icon: FileText, ...BLUE };
    case "app": return { title: "App check", Icon: Smartphone, ...BLUE };
    case "device": return { title: "Device check", Icon: Shield, ...BLUE };
    case "account": return { title: "Account check", Icon: Shield, ...BLUE };
    case "network": case "connection": return { title: "Network check", Icon: Globe, ...BLUE };
    default: return { title: "Investigation", Icon: Search, ...BLUE };
  }
}
