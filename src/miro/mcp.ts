export class MiroMCPClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getBoards() {
    console.log('Miro MCP: fetching boards (read-only)');
    return [];
  }

  async getBoardContent(boardId: string) {
    console.log(`Miro MCP: fetching board content for ${boardId} (read-only)`);
    return [];
  }
}

export const miroClient = new MiroMCPClient(process.env.MIRO_ACCESS_TOKEN || '');
