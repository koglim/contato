import { type ContactCompletionCommand } from "@contatocerto/shared";

const PUBLIC_CODE_REGEX = /CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/i;

export function normalizeTextForCompletion(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[.!;,]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseContactCompletionCommand(rawText: string): ContactCompletionCommand | null {
  // A question mark must never be interpreted as an affirmative command
  if (rawText.includes("?")) {
    return null;
  }

  const match = PUBLIC_CODE_REGEX.exec(rawText);
  if (!match) {
    return null;
  }

  const code = match[0].toUpperCase();
  const normalized = normalizeTextForCompletion(rawText);

  // Check declaration patterns
  const declarationPatterns = [
    new RegExp(`^concluido ${code.toLowerCase()}$`, "u"),
    new RegExp(`^servico concluido ${code.toLowerCase()}$`, "u"),
    new RegExp(`^concluido o servico ${code.toLowerCase()}$`, "u"),
  ];

  if (declarationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "declare", code };
  }

  // Check confirmation patterns
  const confirmationPatterns = [
    new RegExp(`^confirmar ${code.toLowerCase()}$`, "u"),
    new RegExp(`^confirmo ${code.toLowerCase()}$`, "u"),
    new RegExp(`^confirmar conclusao ${code.toLowerCase()}$`, "u"),
    new RegExp(`^confirmo conclusao ${code.toLowerCase()}$`, "u"),
  ];

  if (confirmationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "confirm", code };
  }

  // Check contestation patterns
  const contestationPatterns = [
    new RegExp(`^contestar ${code.toLowerCase()}$`, "u"),
    new RegExp(`^contesto ${code.toLowerCase()}$`, "u"),
    new RegExp(`^contestar conclusao ${code.toLowerCase()}$`, "u"),
    new RegExp(`^contesto conclusao ${code.toLowerCase()}$`, "u"),
  ];

  if (contestationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "contest", code };
  }

  return null;
}
