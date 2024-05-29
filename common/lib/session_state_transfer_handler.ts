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

import { AwsClient } from "./aws_client";
import { SessionState } from "./session_state";

export class SessionStateTransferHandler {
  static resetSessionStateOnCloseFunc: ((sessionState: SessionState, client: AwsClient) => boolean) | undefined;
  static transferSessionStateOnCloseFunc: ((sessionState: SessionState, client: AwsClient) => boolean) | undefined;

  static setResetSessionStateOnCloseFunc(resetFunc: (sessionState: SessionState, client: AwsClient) => boolean): void {
    this.resetSessionStateOnCloseFunc = resetFunc;
  }

  static getResetSessionStateOnCloseFunc(): ((sessionState: SessionState, client: AwsClient) => boolean) | undefined {
    return this.resetSessionStateOnCloseFunc;
  }

  static clearResetSessionStateOnCloseFunc(): void {
    this.resetSessionStateOnCloseFunc = undefined;
  }

  static setTransferSessionStateOnCloseFunc(resetFunc: (sessionState: SessionState, client: AwsClient) => boolean): void {
    this.transferSessionStateOnCloseFunc = resetFunc;
  }

  static getTransferSessionStateOnCloseFunc(): ((sessionState: SessionState, client: AwsClient) => boolean) | undefined {
    return this.transferSessionStateOnCloseFunc;
  }

  static clearTransferSessionStateOnCloseFunc(): void {
    this.transferSessionStateOnCloseFunc = undefined;
  }
}
