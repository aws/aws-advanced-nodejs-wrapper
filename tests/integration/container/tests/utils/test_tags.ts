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

import { Tag } from "@aws-sdk/client-rds";

/**
 * Returns a consistent set of AWS resource tags for test-created resources.
 * This enables identification, cost tracking, and automated cleanup of
 * resources created by integration test runs.
 */
export function getResourceTags(): Tag[] {
  const now = new Date();
  // Use ISO-like format with only tag-safe characters (no commas or special chars)
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return [
    { Key: "env", Value: "test-runner" },
    { Key: "created", Value: timeStr }
  ];
}
