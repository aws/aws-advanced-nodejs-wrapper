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

export class RdsUrlType {
  public static readonly IP_ADDRESS = new RdsUrlType(false, false, false);
  public static readonly RDS_WRITER_CLUSTER = new RdsUrlType(true, true, true);
  public static readonly RDS_READER_CLUSTER = new RdsUrlType(true, true, true);
  public static readonly RDS_CUSTOM_CLUSTER = new RdsUrlType(true, false, true);
  public static readonly RDS_PROXY = new RdsUrlType(true, false, true);
  public static readonly RDS_INSTANCE = new RdsUrlType(true, false, true);
  public static readonly RDS_AURORA_LIMITLESS_DB_SHARD_GROUP = new RdsUrlType(true, false, true);
  public static readonly RDS_GLOBAL_WRITER_CLUSTER = new RdsUrlType(true, true, false);
  public static readonly OTHER = new RdsUrlType(false, false, false);

  private constructor(
    public readonly isRds: boolean,
    public readonly isRdsCluster: boolean,
    public readonly hasRegion: boolean
  ) {}
}
