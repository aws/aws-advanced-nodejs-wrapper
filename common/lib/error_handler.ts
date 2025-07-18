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

import { ClientWrapper } from "./client_wrapper";

export interface ErrorHandler {
  isLoginError(e: Error): boolean;

  isNetworkError(e: Error): boolean;

  isSyntaxError(e: Error): boolean;

  /**
   * Checks whether there has been an unexpected error emitted and if the error is a type of login error.
   */
  hasLoginError(): boolean;

  /**
   * Checks whether there has been an unexpected error emitted and if the error is a type of network error.
   */
  hasNetworkError(): boolean;

  getUnexpectedError(): Error | null;

  /**
   * Attach an error event listener to the event emitter object in the ClientWrapper.
   * The listener will track the latest error emitted to be handled in the future.
   * @param clientWrapper a wrapper containing the target community client.
   */
  attachErrorListener(clientWrapper: ClientWrapper | undefined): void;

  /**
   * Attach a No-Op error listener that ignores any error emitted.
   * @param clientWrapper a wrapper containing the target community client.
   */
  attachNoOpErrorListener(clientWrapper: ClientWrapper | undefined): void;
}
