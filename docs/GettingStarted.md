# Getting Started

## Minimum Requirements

Before using the AWS Advanced NodeJS Wrapper, you must install:

- Node 21.0.0+
- The AWS Advanced NodeJS Wrapper.
- Your choice of underlying Node driver.
  - To use the wrapper with Aurora with PostgreSQL compatibility, install the [PostgreSQL Client](https://github.com/brianc/node-postgres).
  - To use the wrapper with Aurora with MySQL compatibility, install the [MySQL2 Client](https://github.com/sidorares/node-mysql2).

If you are using the AWS Advanced NodeJS Wrapper as part of a Node project, include the wrapper and underlying driver as dependencies.

> **Note:** Depending on which features of the AWS Advanced NodeJS Wrapper you use, you may have additional package requirements. Please refer to this [table](https://github.com/aws/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#list-of-available-plugins) for more information.

## Obtaining the AWS Advanced NodeJS Wrapper

You can use [npm](https://www.npmjs.com/) to obtain the AWS Advanced NodeJS Wrapper by adding the following configuration to the application's `package.json` file:

```json
{
  "dependencies": {
    "aws-advanced-nodejs-wrapper": "^1.0.0"
  }
}
```

## Using the AWS Advanced NodeJS Wrapper

For more detailed information about how to use and configure the AWS Advanced NodeJS Wrapper, please visit [this page](./using-the-nodejs-wrapper/UsingTheNodejsWrapper.md).

## Configuring the Wrapper with AI Tools

If you use an AI coding assistant (Kiro, Cursor, Claude Code, GitHub Copilot, ChatGPT, Amazon Bedrock, etc.), you can use the wrapper's configuration assistant skill to help build, review, or troubleshoot your wrapper configuration.

The skill is a single self-contained markdown file: [`NODEJS-WRAPPER-CONFIGURATION-ASSISTANT.md`](./NODEJS-WRAPPER-CONFIGURATION-ASSISTANT.md). It covers every plugin, parameter, default value, dialect, failover mode, configuration preset, and compatibility constraint of release 3.0.0, together with recipes for `pg`, `mysql2`, the wrapper's pool clients, and Prisma, so the AI can answer configuration questions without access to the wrapper source.

The file follows the [Agent Skills](https://agentskills.io) format. It is large: about 118,000 tokens on Claude Opus 5.5 (other models count tokens differently), and the AI receives it again with every message. Tools that cache the system prompt handle it far more cheaply than tools that resend it in full each time.

### Quick start

1. Download or copy [`NODEJS-WRAPPER-CONFIGURATION-ASSISTANT.md`](./NODEJS-WRAPPER-CONFIGURATION-ASSISTANT.md).
2. Add it to your AI tool:
   - **Tools that support Agent Skills** (Kiro, Cursor, Claude Code, GitHub Copilot in VS Code, and others): create a folder named `nodejs-wrapper-configuration-assistant` in one of the tool's skills directories, and save the file inside it as `SKILL.md`. The folder name must match the `name` field at the top of the file; otherwise the tool does not load the skill.

     | Tool                      | Project skills directory                                   | User skills directory                                             |
     | ------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
     | Kiro                      | `.kiro/skills/`                                            | `~/.kiro/skills/`                                                 |
     | Cursor                    | `.cursor/skills/`, `.agents/skills/`, or `.claude/skills/` | `~/.cursor/skills/`, `~/.agents/skills/`, or `~/.claude/skills/`  |
     | Claude Code               | `.claude/skills/`                                          | `~/.claude/skills/`                                               |
     | GitHub Copilot in VS Code | `.github/skills/`, `.agents/skills/`, or `.claude/skills/` | `~/.copilot/skills/`, `~/.agents/skills/`, or `~/.claude/skills/` |

     For example, to add the skill to a project for Claude Code, Cursor, and VS Code at once:

     ```bash
     mkdir -p .claude/skills/nodejs-wrapper-configuration-assistant
     curl -fsSL -o .claude/skills/nodejs-wrapper-configuration-assistant/SKILL.md \
       https://raw.githubusercontent.com/aws/aws-advanced-nodejs-wrapper/main/docs/NODEJS-WRAPPER-CONFIGURATION-ASSISTANT.md
     ```

   - **Claude Projects**: upload it as a project knowledge document.
   - **ChatGPT custom GPT**: upload it as a knowledge file.
   - **Amazon Bedrock**: send the file as the system prompt of your `InvokeModel` or `Converse` request. Avoid attaching it to a Bedrock knowledge base: a knowledge base passes the model only the passages that match each question, so the skill's interview steps and rules (section 1 of the file) may be missing.
   - **Plain chat (ChatGPT, Claude, Gemini)**: paste it at the start of a new conversation, then ask your question.

3. Ask the AI for help. It will interview you when it needs more details, or give you a configuration straight away if you ask it to skip the interview.

### Example prompts

The simplest way to start:

```
Help me configure the AWS Advanced NodeJS Wrapper for my application.
```

Skip the interview when you already know what you want:

```
Give me a default configuration for Aurora PostgreSQL with the pg driver, the wrapper's pool client, and failover support.
```

Review an existing configuration:

```
Review this wrapper configuration and tell me what to change:

<paste your AwsPgClient, AwsMySQLClient, or pool client configuration here>
```

Diagnose an error:

```
My service on Aurora MySQL fails to connect with "UnsupportedMethodError: Keep alive
configuration is not supported for MySQL2." What's wrong?
```

The skill targets release 3.0.0 and avoids guessing: if it doesn't know something, it says so and points you at the official docs.
