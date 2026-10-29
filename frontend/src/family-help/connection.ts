// How the Family Help picture travels between the two phones, in plain words for both people.
// Pure: no React, no native imports.
import type { ConnectionPath } from "@/modules/apollo-family-assist";
import type { Tone } from "@/src/components/ui";

export interface ConnectionStatus { label: string; detail: string; tone: Tone }

const STATUS: Record<ConnectionPath, ConnectionStatus> = {
  connecting: { label: "Connecting", detail: "Setting up the private connection between the two phones.", tone: "neutral" },
  direct: { label: "Direct connection", detail: "The picture goes straight between the two phones.", tone: "resting" },
  relayed: { label: "Relayed connection", detail: "A direct path wasn't possible, so the picture goes through a secure relay. It stays encrypted the whole way.", tone: "resting" },
  reconnecting: { label: "Reconnecting", detail: "The connection dropped for a moment. ApolloSG is trying to restore it.", tone: "growling" },
};

/** Nothing to show until the device reports a path for this session (and never in the web preview). */
export function connectionStatus(path: ConnectionPath | null | undefined): ConnectionStatus | null {
  return path && path in STATUS ? STATUS[path] : null;
}
