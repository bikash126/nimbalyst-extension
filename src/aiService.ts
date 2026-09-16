import type { ExtensionAIService } from '@nimbalyst/extension-sdk';

let aiService: ExtensionAIService | undefined;

export function setAiService(service: ExtensionAIService | undefined) {
  aiService = service;
}

export async function sendSessionPrompt(options: { prompt: string; sessionName?: string }): Promise<boolean> {
  if (!aiService) return false;
  await aiService.sendPrompt(options);
  return true;
}
