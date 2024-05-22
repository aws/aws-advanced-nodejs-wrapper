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

export class DatabaseDialectCodes {
  static readonly AURORA_MYSQL: string = "aurora-mysql";
  static readonly RDS_MYSQL: string = "rds-mysql";
  static readonly MYSQL: string = "mysql";
  static readonly AURORA_PG: string = "aurora-pg";
  static readonly RDS_PG: string = "rds-pg";
  static readonly PG: string = "pg";
  static readonly CUSTOM: string = "custom";
}
