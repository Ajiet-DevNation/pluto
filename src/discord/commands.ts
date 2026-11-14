/**
 * Guild-scoped slash commands.
 *
 * Registration goes through a guild command manager (discord.js
 * `guild.commands.set`), which is the guild-scoped route. Global application
 * commands are never registered by this bot.
 */

import { SlashCommandBuilder } from 'discord.js';

export const optOutCommand = new SlashCommandBuilder()
  .setName('optout')
  .setDescription('Opt out of Pluto indexing your Discord messages.')
  .setDMPermission(false);

export const askCommand = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask a question grounded in indexed project sources.')
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('The question to answer from indexed project records')
      .setRequired(true),
  );

export type CommandPayload = ReturnType<SlashCommandBuilder['toJSON']>;

export function commandPayloads(): CommandPayload[] {
  return [optOutCommand.toJSON(), askCommand.toJSON()];
}

export interface GuildCommandManager {
  set(commands: CommandPayload[]): Promise<unknown>;
}

export async function registerGuildCommands(
  manager: GuildCommandManager,
): Promise<void> {
  await manager.set(commandPayloads());
}
