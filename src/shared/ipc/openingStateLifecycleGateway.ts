import { invoke } from '@tauri-apps/api/core';

import { COMMANDS, type CommandName } from './commands';
import type {
  OpeningStateOnboardingStatusResult,
  SetOpeningStateOnboardingChoiceRequest,
} from './openingStateLifecycleDto';
import { GatewayError } from './gateway';
import { parseTauriError } from '../utils/tauriError';

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getOpeningStateOnboardingStatus(
  sessionToken: string,
): Promise<OpeningStateOnboardingStatusResult> {
  return call<OpeningStateOnboardingStatusResult>(
    COMMANDS.GET_OPENING_STATE_ONBOARDING_STATUS,
    { sessionToken },
  );
}

export function setOpeningStateOnboardingChoice(
  sessionToken: string,
  request: SetOpeningStateOnboardingChoiceRequest,
): Promise<OpeningStateOnboardingStatusResult> {
  return call<OpeningStateOnboardingStatusResult>(
    COMMANDS.SET_OPENING_STATE_ONBOARDING_CHOICE,
    { sessionToken, request },
  );
}
