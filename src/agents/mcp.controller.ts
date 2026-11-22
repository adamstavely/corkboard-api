import { Controller, Delete, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Response } from 'express';
import { ForAgents, type AuthedRequest } from '../auth/auth.guard';
import { AgentsService } from './agents.service';
import { mcpServer } from './mcp-server';

/** The answer to the methods a stateless server doesn't serve: no sessions to stream to or end. */
const NOT_ALLOWED = { jsonrpc: '2.0', error: { code: -32000, message: 'This MCP server is stateless: send requests with POST.' }, id: null };

/**
 * Corkboard as a remote MCP server, over streamable HTTP, stateless: each POST gets a fresh server holding the token's
 * owner and scopes. It takes the same personal access tokens as the agent API (see docs/mcp.md), rate-limited the same.
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  constructor(private readonly agents: AgentsService) {}

  @Post()
  @ForAgents()
  async handle(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const server = mcpServer(this.agents, req.user, req.agent!);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  @ForAgents()
  @HttpCode(405)
  stream(): typeof NOT_ALLOWED {
    return NOT_ALLOWED;
  }

  @Delete()
  @ForAgents()
  @HttpCode(405)
  end(): typeof NOT_ALLOWED {
    return NOT_ALLOWED;
  }
}
