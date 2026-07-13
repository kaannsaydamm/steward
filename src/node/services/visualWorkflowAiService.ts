import { generateText } from "ai";

import { VisualWorkflowSpecSchema } from "@/common/orpc/schemas/api";
import { getErrorMessage } from "@/common/utils/errors";
import type { AIService } from "@/node/services/aiService";
import { runLanguageModelCleanup } from "@/node/services/languageModelCleanup";
import type { VisualWorkflowSpec } from "@/node/services/visualWorkflowService";

type EditableVisualWorkflowSpec = Omit<VisualWorkflowSpec, "updatedAt">;

const EditableVisualWorkflowSpecSchema = VisualWorkflowSpecSchema.omit({ updatedAt: true });

export function extractVisualWorkflowJson(text: string): unknown {
  const source = text.trim();
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("The selected model did not return valid workflow JSON");
}

function resolveWorkspaceModel(
  requestedModel: string,
  metadata: {
    taskModelString?: string;
    aiSettings?: { model: string };
    aiSettingsByAgent?: Record<string, { model: string }>;
  }
): string {
  const model =
    (requestedModel.trim() || metadata.aiSettingsByAgent?.exec?.model) ??
    metadata.aiSettings?.model ??
    metadata.taskModelString;
  if (!model?.trim()) {
    throw new Error("Select a model for the chosen workspace before using AI Build");
  }
  return model.trim();
}

export async function generateVisualWorkflowWithAI(options: {
  aiService: AIService;
  workspaceId: string;
  model: string;
  request: string;
  current: EditableVisualWorkflowSpec;
}): Promise<{ spec: EditableVisualWorkflowSpec; modelUsed: string }> {
  const metadataResult = await options.aiService.getWorkspaceMetadata(options.workspaceId);
  if (!metadataResult.success) throw new Error(metadataResult.error);

  const modelUsed = resolveWorkspaceModel(options.model, metadataResult.data);
  const modelResult = await options.aiService.createModel(modelUsed, undefined, {
    agentInitiated: true,
    workspaceId: options.workspaceId,
  });
  if (!modelResult.success) {
    throw new Error(`Could not start ${modelUsed}: ${getErrorMessage(modelResult.error)}`);
  }

  try {
    const result = await generateText({
      model: modelResult.data,
      abortSignal: AbortSignal.timeout(90_000),
      maxOutputTokens: 16_000,
      prompt: [
        "You edit Steward executable workflow graphs.",
        "Return only one JSON object containing the complete replacement graph. Do not use Markdown or commentary.",
        "Preserve useful existing nodes unless the request asks to replace them.",
        "The graph must contain exactly one input and one output, remain acyclic, and every node must lie on a path from input to output.",
        "Use stable unique IDs and non-overlapping positions. Multiple incoming and outgoing edges are allowed.",
        "Agent IDs: explore, plan, exec. Agent nodes may set model to any configured provider:model ID, or omit it to inherit the workspace model.",
        "Action kinds: http-request, websocket, shell, powershell, ssh, file-read, file-write, build, test, git, mcp-tool, subworkflow, transform, container, database, notification.",
        "Keep version at 2. Include slug, name, description, nodes, and edges. Do not include updatedAt.",
        `User request:\n${options.request}`,
        `Current graph:\n${JSON.stringify(options.current)}`,
      ].join("\n\n"),
    });
    return {
      spec: EditableVisualWorkflowSpecSchema.parse(
        extractVisualWorkflowJson(result.text)
      ) as EditableVisualWorkflowSpec,
      modelUsed,
    };
  } finally {
    runLanguageModelCleanup(modelResult.data);
  }
}
