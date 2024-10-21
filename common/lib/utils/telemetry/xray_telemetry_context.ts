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
import { TelemetryTraceLevel } from "./telemetry_trace_level";
import { getNamespace, getSegment, Segment, setSegment, Subsegment } from "aws-xray-sdk";
import { TelemetryConst } from "./telemetry_const";
import { logger } from "../../../logutils";

export class XRayTelemetryContext implements TelemetryContext {
  private readonly name: string;
  private currentSegment: Segment | Subsegment | undefined;
  private readonly traceLevel: TelemetryTraceLevel;
  readonly annotations: Map<string, string> = new Map();

  constructor(name: string, traceLevel: TelemetryTraceLevel) {
    this.name = name;
    this.traceLevel = traceLevel;
  }

  async start(func: () => any): Promise<any> {
    try {
      this.currentSegment = getSegment();
    } catch (error: any) {
      // Ignore.
    }

    let effectiveTraceLevel = this.traceLevel;
    if (!this.currentSegment && this.traceLevel === TelemetryTraceLevel.NESTED) {
      effectiveTraceLevel = TelemetryTraceLevel.TOP_LEVEL;
    }

    const ns = getNamespace();

    switch (effectiveTraceLevel) {
      case TelemetryTraceLevel.FORCE_TOP_LEVEL:
      case TelemetryTraceLevel.TOP_LEVEL:
        return await ns.runAndReturn(async () => {
          const segment = new Segment(this.name);
          if (this.currentSegment) {
            const parentId = this.currentSegment.id;
            this.currentSegment = segment;
            this.setAttribute(TelemetryConst.PARENT_TRACE_ANNOTATION, parentId);
          } else {
            this.currentSegment = segment;
          }
          setSegment(this.currentSegment!);

          this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);
          logger.info(`[XRay] Telemetry '${this.name}' trace ID: ${this.currentSegment?.id}`);

          return await this.executeMethod(func);
        });
      case TelemetryTraceLevel.NESTED:
        return await ns.runAndReturn(async () => {
          const subsegment = this.currentSegment!.addNewSubsegment(this.name);
          const parentId = this.currentSegment!.id;
          setSegment(subsegment);
          this.currentSegment = subsegment;
          this.setAttribute(TelemetryConst.PARENT_TRACE_ANNOTATION, parentId);
          this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);

          return await this.executeMethod(func);
        });
      case TelemetryTraceLevel.NO_TRACE:
        // Do not post this trace.
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
      this.currentSegment?.close();
    }
  }

  async createSegmentCopy(telemetryContext: XRayTelemetryContext): Promise<void> {
    const ns = getNamespace();
    return await ns.runAndReturn(async () => {
      this.currentSegment = new Segment(this.name);
      setSegment(this.currentSegment!);

      for (const [key, value] of Object.entries(telemetryContext.annotations)) {
        this.setAttribute(key, value);
      }
      this.setAttribute(TelemetryConst.TRACE_NAME_ANNOTATION, this.name);
      this.setAttribute(TelemetryConst.SOURCE_TRACE_ANNOTATION, telemetryContext.currentSegment?.id ?? "Unknown trace source");

      logger.info(`[XRay] Telemetry '${this.name}' trace ID: ${this.currentSegment?.id}`);

      this.currentSegment?.close();
    });
  }

  getName(): string {
    return this.name;
  }

  setAttribute(key: string, value: string): void {
    if (this.currentSegment) {
      this.currentSegment.addAnnotation(key, value);
      this.annotations.set(key, value);
    }
  }

  setError(error: Error): void {
    if (this.currentSegment) {
      this.currentSegment.addError(error);
    }
  }

  // Segments do not have a set success method.
  setSuccess(success: boolean): void {}

  setFailure(error: Error): void {
    this.setError(error);
  }

  static async postCopy(telemetryContext: XRayTelemetryContext, traceLevel: TelemetryTraceLevel): Promise<void> {
    if (traceLevel === TelemetryTraceLevel.NO_TRACE) {
      return;
    }

    if (traceLevel === TelemetryTraceLevel.FORCE_TOP_LEVEL || traceLevel === TelemetryTraceLevel.TOP_LEVEL) {
      const context = new XRayTelemetryContext(`${TelemetryConst.COPY_TRACE_NAME_PREFIX}${telemetryContext.name}`, traceLevel);
      await context.createSegmentCopy(telemetryContext);
    }
  }
}
