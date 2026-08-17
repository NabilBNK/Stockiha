import { invoke } from "@tauri-apps/api/core";

import { COMMANDS, type CommandName } from "./commands";
import type { InventoryCorrectionsSetting } from "./dto";
import { GatewayError } from "./gateway";
import { parseTauriError } from "../utils/tauriError";

async function call<T>(
  command: CommandName,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw new GatewayError(parseTauriError(error));
  }
}

export function getInventoryCorrectionsSetting(
  sessionToken: string,
): Promise<InventoryCorrectionsSetting> {
  return call<InventoryCorrectionsSetting>(
    COMMANDS.GET_INVENTORY_CORRECTIONS_SETTING,
    { sessionToken },
  );
}

export function updateInventoryCorrectionsSetting(
  sessionToken: string,
  enabled: boolean,
): Promise<InventoryCorrectionsSetting> {
  return call<InventoryCorrectionsSetting>(
    COMMANDS.UPDATE_INVENTORY_CORRECTIONS_SETTING,
    {
      sessionToken,
      request: { enabled },
    },
  );
}
