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

import { AwsWrapperError } from "../../utils/errors";
import { Messages } from "../../utils/messages";

export class BlueGreenPhase {
  static readonly NOT_CREATED: BlueGreenPhase = new BlueGreenPhase("NOT_CREATED", 0, false);
  static readonly CREATED: BlueGreenPhase = new BlueGreenPhase("CREATED", 1, false);
  static readonly PREPARATION: BlueGreenPhase = new BlueGreenPhase("PREPARATION", 2, true);
  static readonly IN_PROGRESS: BlueGreenPhase = new BlueGreenPhase("IN_PROGRESS", 3, true);
  static readonly POST: BlueGreenPhase = new BlueGreenPhase("POST", 4, true);
  static readonly COMPLETED: BlueGreenPhase = new BlueGreenPhase("COMPLETED", 5, true);

  private readonly _name: string;
  private readonly _phase: number;
  private readonly _isActiveSwitchoverOrCompleted: boolean;

  constructor(name: string, phase: number, activeSwitchoverOrCompleted: boolean) {
    this._name = name;
    this._phase = phase;
    this._isActiveSwitchoverOrCompleted = activeSwitchoverOrCompleted;
  }

  private static readonly blueGreenStatusMapping: { [key: string]: BlueGreenPhase } = {
    AVAILABLE: BlueGreenPhase.CREATED,
    SWITCHOVER_INITIATED: BlueGreenPhase.PREPARATION,
    SWITCHOVER_IN_PROGRESS: BlueGreenPhase.IN_PROGRESS,
    SWITCHOVER_IN_POST_PROCESSING: BlueGreenPhase.POST,
    SWITCHOVER_COMPLETED: BlueGreenPhase.COMPLETED
  };

  public static parsePhase(value?: string, version?: string): BlueGreenPhase {
    if (!value) {
      return BlueGreenPhase.NOT_CREATED;
    }

    // Version parameter may be used to identify a proper mapping.
    // For now lets assume that mapping is always the same.
    const phase = this.blueGreenStatusMapping[value.toUpperCase()];

    if (!phase) {
      throw new AwsWrapperError(Messages.get("bgd.unknownStatus", value));
    }
    return phase;
  }

  get name(): string {
    return this._name;
  }

  get phase(): number {
    return this._phase;
  }

  get isActiveSwitchoverOrCompleted(): boolean {
    return this._isActiveSwitchoverOrCompleted;
  }
}
