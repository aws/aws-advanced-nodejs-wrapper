/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { TelemetryContext } from "./telemetry_context";
import { context, createContextKey, Span as APISpan, SpanStatusCode, trace, Tracer } from "@opentelemetry/api";
import { TelemetryTraceLevel } from "./telemetry_trace_level";
import { TelemetryConst } from "./telemetry_const";
import { api } from "@opentelemetry/sdk-node";
import { logger } from "../../../logutils";
import { OpenTelemetryFactory } from "./open_telemetry_factory";

export class OpenTelemetryContext implements TelemetryContext {
  private readonly tracer: Tracer;
  private readonly traceLevel: TelemetryTraceLevel;
  private span?: APISpan;
  readonly name: string;
  readonly attributes: Map<string, string> = new Map();

  constructor(tracer: Tracer, name: string, traceLevel: TelemetryTraceLevel) {
    this.name = name;
    this.tracer = tracer;
    this.traceLevel = traceLevel;
  }

  async start(func: () => any): Promise<any> {
    const activeContext = context.active();
    const isRoot = activeContext === api.ROOT_CONTEXT;

    let effectiveTraceLevel: TelemetryTraceLevel = this.traceLevel;
    if (isRoot && this.traceLevel === TelemetryTraceLevel.NESTED) {
      effectiveTraceLevel = TelemetryTraceLevel.TOP_LEVEL;
    }
    const key = createContextKey(`${this.name}-key`);
    this.span = trace.getActiveSpan();

    switch (effectiveTraceLevel) {
      case TelemetryTraceLevel.FORCE_TOP_LEVEL:
      case TelemetryTraceLevel.TOP_LEVEL:
        return await context.with(activeContext.setValue(key, "context"), async () => {
          return await this.tracer.startActiveSpan(this.name, async (span: APISpan) => {
            if (!isRoot && this.span) {
              const parentId = this.span.spanContext().spanId;
              this.span = span;
              this.setAttribute(TelemetryConst.PARENT_TRACE_ANNOTATION, parentId);
            } else {
              this.span = span;
            }

            this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);
            logger.info(`[OTLP] Telemetry '${this.name}' trace ID: ${this.span.spanContext().traceId}`);

            return await this.executeMethod(func);
          });
        });
      case TelemetryTraceLevel.NESTED:
        return await this.tracer.startActiveSpan(this.name, async (span: APISpan) => {
          const parentId = this.span!.spanContext().spanId;
          this.span = span;
          this.setAttribute(TelemetryConst.PARENT_TRACE_ANNOTATION, parentId);
          this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);

          return await this.executeMethod(func);
        });
      case TelemetryTraceLevel.NO_TRACE:
        // Do not post this context.
        return await func();
      default:
        return await func();
    }
  }

  private async executeMethod(func: () => any): Promise<any> {
    try {
      const result = await func();
      this.setSuccess(true);
      return result;
    } catch (error: any) {
      this.setFailure(error);
      throw error;
    } finally {
      this.span?.end();
    }
  }

  async createSpanCopy(telemetryContext: OpenTelemetryContext): Promise<void> {
    const activeContext = api.ROOT_CONTEXT;
    const key = createContextKey(`${this.name}-key`);
    return context.with(activeContext.setValue(key, "context"), () => {
      return this.tracer.startActiveSpan(this.name, (span: APISpan) => {
        this.span = span;

        for (const [key, value] of Object.entries(telemetryContext.attributes)) {
          this.setAttribute(key, value);
        }
        this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);
        this.setAttribute(TelemetryConst.SOURCE_TRACE_ANNOTATION, telemetryContext.span!.spanContext().spanId ?? "Unknown trace source");

        span.end();
      });
    });
  }

  getName(): string {
    return this.name;
  }

  setAttribute(key: string, value: string): void {
    if (this.span) {
      this.span.setAttribute(key, value);
      this.attributes.set(key, value);
    }
  }

  setError(error: Error): void {
    if (this.span) {
      this.span
        .setAttribute(TelemetryConst.EXCEPTION_TYPE_ANNOTATION, error.name)
        .setAttribute(TelemetryConst.EXCEPTION_MESSAGE_ANNOTATION, error.message)
        .setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        .recordException(error);
    }
  }

  setSuccess(success: boolean): void {
    if (this.span) {
      if (success) {
        this.span.setStatus({ code: SpanStatusCode.OK });
      } else {
        this.span.setStatus({ code: SpanStatusCode.ERROR });
      }
    }
  }

  setFailure(error: Error): void {
    this.setSuccess(false);
    this.setError(error);
  }

  static async postCopy(telemetryContext: OpenTelemetryContext, traceLevel: TelemetryTraceLevel): Promise<void> {
    if (traceLevel === TelemetryTraceLevel.NO_TRACE || !telemetryContext.span) {
      return;
    }

    if (traceLevel === TelemetryTraceLevel.FORCE_TOP_LEVEL || traceLevel === TelemetryTraceLevel.TOP_LEVEL) {
      const context = new OpenTelemetryContext(
        trace.getTracer(OpenTelemetryFactory.INSTRUMENTATION_NAME),
        `${TelemetryConst.COPY_TRACE_NAME_PREFIX}${telemetryContext.name}`,
        traceLevel
      );
      await context.createSpanCopy(telemetryContext);
    }
  }
}
