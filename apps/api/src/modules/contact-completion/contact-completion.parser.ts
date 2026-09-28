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

export interface ParsedCompletionCommand {
  kind: "declare" | "confirm" | "contest";
  code: string | null;
}

export function parseContactCompletionCommand(rawText: string): ParsedCompletionCommand | null {
  // A question mark must never be interpreted as an affirmative command
  if (rawText.includes("?")) {
    return null;
  }

  const normalized = normalizeTextForCompletion(rawText);
  if (!normalized) return null;

  const match = PUBLIC_CODE_REGEX.exec(rawText);
  if (match) {
    const code = match[0].toUpperCase();
    const codeLower = code.toLowerCase();

    // Check declaration patterns with explicit code
    const declarationPatterns = [
      new RegExp(`^concluido ${codeLower}$`, "u"),
      new RegExp(`^servico concluido ${codeLower}$`, "u"),
      new RegExp(`^concluido o servico ${codeLower}$`, "u"),
      new RegExp(`^ja terminei ${codeLower}$`, "u"),
      new RegExp(`^finalizei ${codeLower}$`, "u"),
    ];
    if (declarationPatterns.some((pattern) => pattern.test(normalized))) {
      return { kind: "declare", code };
    }

    // Check confirmation patterns with explicit code
    const confirmationPatterns = [
      new RegExp(`^confirmar ${codeLower}$`, "u"),
      new RegExp(`^confirmo ${codeLower}$`, "u"),
      new RegExp(`^confirmar conclusao ${codeLower}$`, "u"),
      new RegExp(`^confirmo conclusao ${codeLower}$`, "u"),
      new RegExp(`^confirmo o atendimento ${codeLower}$`, "u"),
      new RegExp(`^confirmado ${codeLower}$`, "u"),
    ];
    if (confirmationPatterns.some((pattern) => pattern.test(normalized))) {
      return { kind: "confirm", code };
    }

    // Check contestation patterns with explicit code
    const contestationPatterns = [
      new RegExp(`^contestar ${codeLower}$`, "u"),
      new RegExp(`^contesto ${codeLower}$`, "u"),
      new RegExp(`^contestar conclusao ${codeLower}$`, "u"),
      new RegExp(`^contesto conclusao ${codeLower}$`, "u"),
      new RegExp(`^nao foi concluido ${codeLower}$`, "u"),
      new RegExp(`^nao deu certo ${codeLower}$`, "u"),
    ];
    if (contestationPatterns.some((pattern) => pattern.test(normalized))) {
      return { kind: "contest", code };
    }

    return null;
  }

  // Code-free patterns (no CC-XXXXXXXX present)
  // Check declaration patterns without code
  const codeFreeDeclarationPatterns = [
    /^concluido$/u,
    /^servico concluido$/u,
    /^concluido o servico$/u,
    /^ja terminei$/u,
    /^ja terminei o servico$/u,
    /^terminei o servico$/u,
    /^ja finalizei$/u,
    /^finalizei o servico$/u,
    /^servico finalizado$/u,
    /^ja foi concluido$/u,
  ];
  if (codeFreeDeclarationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "declare", code: null };
  }

  // Check confirmation patterns without code
  const codeFreeConfirmationPatterns = [
    /^confirmar$/u,
    /^confirmo$/u,
    /^confirmar conclusao$/u,
    /^confirmo conclusao$/u,
    /^confirmo o atendimento$/u,
    /^confirmado$/u,
  ];
  if (codeFreeConfirmationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "confirm", code: null };
  }

  // Check contestation patterns without code
  const codeFreeContestationPatterns = [
    /^contestar$/u,
    /^contesto$/u,
    /^contestar conclusao$/u,
    /^confirmo contestacao$/u,
    /^nao foi concluido$/u,
    /^nao deu certo$/u,
    /^nao foi finalizado$/u,
    /^servico nao concluido$/u,
  ];
  if (codeFreeContestationPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "contest", code: null };
  }

  return null;
}
