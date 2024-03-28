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
import { performance } from 'perf_hooks';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shuffleList(list: any[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

export function logTopology(hosts: HostInfo[], msgPrefix: string) {
  let msg = "<null>";
  if (hosts.length > 1) {
    msg = "\n " + hosts.join("\n ");
  }
  return `${msgPrefix}${Messages.get("Utils.topology", msg)}`;
}

export function getTimeInNanos() {
  return performance.now();
}

export function maskProperties(props: Map<string, any>) {
  const maskedProperties = new Map(props);
  if (maskedProperties.has(WrapperProperties.PASSWORD.name)) {
    maskedProperties.set(WrapperProperties.PASSWORD.name, "***");
  }
  return maskedProperties;
}
