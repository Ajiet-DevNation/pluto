/**
 * Guild-scoped slash commands.
 *
 * Registration goes through a guild command manager (discord.js
 * `guild.commands.set`), which is the guild-scoped route. Global application
 * commands are never registered by this bot.
 *
 * P1 owns `/optout`; P3 owns `/digest`, `/upcoming`, `/event` and `/help`.
 * `/ask` was removed from active v1 on 2026-11-18; its retrieval engine is
 * retained for a future re-enable. The builders live in their feature modules;
 * this file stays the single command registry so the shared registration path
 * is not forked.
 */

import { SlashCommandBuilder } from 'discord.js';
import { digestCommand } from '../digest/command';
import { eventCommand } from '../events/command';
import { helpCommand } from '../help/command';
import { upcomingCommand } from '../upcoming/command';

export const optOutCommand = new SlashCommandBuilder()
  .setName('optout')
  .setDescription('Opt out of Pluto indexing your Discord messages.')
  .setDMPermission(false);

export {
  digestCommand,
  eventCommand,
  helpCommand,
  upcomingCommand,
};

export type CommandPayload = ReturnType<SlashCommandBuilder['toJSON']>;

export function commandPayloads(): CommandPayload[] {
  return [
    optOutCommand.toJSON(),
    digestCommand.toJSON(),
    upcomingCommand.toJSON(),
    eventCommand.toJSON(),
    helpCommand.toJSON(),
  ];
}

export interface GuildCommandManager {
  set(commands: CommandPayload[]): Promise<unknown>;
}

export async function registerGuildCommands(
  manager: GuildCommandManager,
): Promise<void> {
  await manager.set(commandPayloads());
}
