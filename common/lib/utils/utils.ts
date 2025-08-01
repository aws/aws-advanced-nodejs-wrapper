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
import { TopologyAwareDatabaseDialect } from "../topology_aware_database_dialect";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepWithAbort(ms: number, message?: string) {
  let abortSleep;
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
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

export function getTimeInNanos() {
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

export class Pair<K, V> {
  private readonly _left: K;
  private readonly _right: V;

  constructor(value1: K, value2: V) {
    this._left = value1;
    this._right = value2;
  }

  get left(): K {
    return this._left;
  }

  get right(): V {
    return this._right;
  }
}
