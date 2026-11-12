import { HarnessCommandSchema, type HarnessCommand } from "./commands"

export function isHarnessCommand(value: unknown): value is HarnessCommand {
  return HarnessCommandSchema.safeParse(value).success
}
