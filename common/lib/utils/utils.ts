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

import { HostInfo } from "../host_info";
import { Messages } from "./messages";
import { WrapperProperties } from "../wrapper_property";
import { HostRole } from "../host_role";
import { logger } from "../../logutils";
import { AwsWrapperError, InternalQueryTimeoutError } from "./errors";
import { TopologyAwareDatabaseDialect } from "../database_dialect/topology_aware_database_dialect";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a sleep promise that can be aborted before completion.
 *
 * @param ms - Duration to sleep in milliseconds
 * @param message - Error message when aborted
 * @returns A tuple of [sleepPromise, abortFunction]
 *          - sleepPromise: Resolves after ms milliseconds, or rejects if aborted
 *          - abortFunction: Call to cancel the sleep and reject the promise
 */
export function sleepWithAbort(ms: number, message?: string) {
  let abortSleep;
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    // Unref the timer to prevent this background task from blocking the application from gracefully exiting.
    timeout.unref();
    abortSleep = () => {
      clearTimeout(timeout);
      reject(new AwsWrapperError(message));
    };
  });
  return [promise, abortSleep];
}

export function getTimeoutTask(timer: any, message: string, timeoutValue: number): Promise<void> {
  return new Promise((_resolve, reject) => {
    timer.timeoutId = setTimeout(() => {
      reject(new InternalQueryTimeoutError(message));
    }, timeoutValue);
  });
}

export function getCurrentTimeNano() {
  return Number(process.hrtime.bigint());
}

export function shuffleList(list: any[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

export function logTopology(hosts: HostInfo[], msgPrefix: string) {
  let msg = "<null>";
  if (hosts.length !== 0) {
    msg = "\n " + hosts.join("\n ");
  }
  return `${msgPrefix}${Messages.get("Utils.topology", msg)}`;
}

export function getTimeInNanos(): bigint {
  return process.hrtime.bigint();
}

export function convertNanosToMs(nanos: bigint) {
  return Number(nanos) / 1000000;
}

export function convertMsToNanos(millis: number): bigint {
  return BigInt(millis * 1000000);
}

export function convertNanosToMinutes(nanos: bigint) {
  return Number(nanos) / 60_000_000_000;
}

export function maskProperties(props: Map<string, any>) {
  const maskedProperties = new Map(props);
  if (maskedProperties.has(WrapperProperties.PASSWORD.name)) {
    maskedProperties.set(WrapperProperties.PASSWORD.name, "***");
  }
  if (maskedProperties.has("ssl")) {
    // Mask SSL configuration to avoid logging long certificates.
    maskedProperties.set("ssl", "***");
  }
  // Remove connectionProvider property before displaying. AwsMysqlPoolClient.targetPool throws
  // "TypeError: Converting circular structure to JSON" when sent to JSON.stringify.
  maskedProperties.delete(WrapperProperties.CONNECTION_PROVIDER.name);
  return maskedProperties;
}

export function getWriter(hosts: HostInfo[], errorMessage?: string): HostInfo | null {
  const writerHost = hosts.find((x) => x.role === HostRole.WRITER) ?? null;
  if (!writerHost && errorMessage) {
    logAndThrowError(errorMessage);
  }
  return writerHost;
}

export function logAndThrowError(message: string) {
  logger.error(message);
  throw new AwsWrapperError(message);
}

export function equalsIgnoreCase(value1: string | null, value2: string | null): boolean {
  return value1 != null && value2 != null && value1.localeCompare(value2, undefined, { sensitivity: "accent" }) === 0;
}

export function isDialectTopologyAware(dialect: any): dialect is TopologyAwareDatabaseDialect {
  return dialect;
}

export function containsHostAndPort(hosts: HostInfo[] | null | undefined, hostAndPort: string): boolean {
  if (hosts?.length === 0) {
    return false;
  }

  return hosts.some((host) => host.hostAndPort === hostAndPort);
}

export function parseInstanceTemplates(
  instanceTemplatesString: string | null,
  hostValidator: (hostPattern: string) => void,
  hostInfoBuilderFunc: () => { withHost(host: string): { build(): HostInfo } }
): Map<string, HostInfo> {
  if (!instanceTemplatesString) {
    throw new AwsWrapperError(Messages.get("Utils.globalClusterInstanceHostPatternsRequired"));
  }

  const instanceTemplates = new Map<string, HostInfo>();
  const patterns = instanceTemplatesString.split(",");

  for (const pattern of patterns) {
    const trimmedPattern = pattern.trim();
    const colonIndex = trimmedPattern.indexOf(":");
    if (colonIndex === -1) {
      throw new AwsWrapperError(Messages.get("Utils.invalidPatternFormat", trimmedPattern));
    }

    const region = trimmedPattern.substring(0, colonIndex).trim();
    const hostPattern = trimmedPattern.substring(colonIndex + 1).trim();

    if (!region || !hostPattern) {
      throw new AwsWrapperError(Messages.get("Utils.invalidPatternFormat", trimmedPattern));
    }

    hostValidator(hostPattern);

    const hostInfo = hostInfoBuilderFunc().withHost(hostPattern).build();
    instanceTemplates.set(region, hostInfo);
  }

  logger.debug(`Detected Global Database patterns: ${JSON.stringify(Array.from(instanceTemplates.entries()))}`);

  return instanceTemplates;
}
