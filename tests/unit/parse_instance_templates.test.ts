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

import { RdsUtils } from "../../common/lib/utils/rds_utils";
import { AwsWrapperError } from "../../common/lib/utils/errors";
import { HostInfo } from "../../common/lib/host_info";

const noopValidator = () => {
  /* host pattern validation is exercised by the host list provider tests */
};

function builder() {
  return {
    withHost(host: string) {
      return {
        build(): HostInfo {
          return { host } as HostInfo;
        }
      };
    }
  };
}

const rdsUtils = new RdsUtils();

function parse(value: string | null): Map<string, HostInfo> {
  return rdsUtils.parseInstanceTemplates(value, noopValidator, builder);
}

describe("RdsUtils.parseInstanceTemplates", () => {
  it("derives the region from an RDS instance endpoint pattern", () => {
    const templates = parse("?.abc123.us-east-2.rds.amazonaws.com,?.def456.us-west-2.rds.amazonaws.com");

    expect([...templates.keys()]).toEqual(["us-east-2", "us-west-2"]);
    expect(templates.get("us-east-2")?.host).toBe("?.abc123.us-east-2.rds.amazonaws.com");
    expect(templates.get("us-west-2")?.host).toBe("?.def456.us-west-2.rds.amazonaws.com");
  });

  it("accepts an explicit region in square brackets, for custom domains", () => {
    const templates = parse("[us-east-2]?.customHost,[us-west-2]?.anotherCustomHost");

    expect(templates.get("us-east-2")?.host).toBe("?.customHost");
    expect(templates.get("us-west-2")?.host).toBe("?.anotherCustomHost");
  });

  it("keeps a port when the region is given in square brackets", () => {
    const templates = parse("[us-east-2]?.customHost:8888,[us-west-2]?.anotherCustomHost:9999");

    expect(templates.get("us-east-2")?.host).toBe("?.customHost:8888");
    expect(templates.get("us-west-2")?.host).toBe("?.anotherCustomHost:9999");
  });

  it("accepts an explicit colon-separated region", () => {
    const templates = parse("us-east-2:?.abc123.us-east-2.rds.amazonaws.com,us-west-2:?.customHost");

    expect(templates.get("us-east-2")?.host).toBe("?.abc123.us-east-2.rds.amazonaws.com");
    expect(templates.get("us-west-2")?.host).toBe("?.customHost");
  });

  it("does not mistake a port for a region prefix", () => {
    const templates = parse("[us-east-2]?.abc123.us-east-2.rds.amazonaws.com:8888");

    expect([...templates.keys()]).toEqual(["us-east-2"]);
    expect(templates.get("us-east-2")?.host).toBe("?.abc123.us-east-2.rds.amazonaws.com:8888");
  });

  it("tolerates surrounding whitespace and normalises region case", () => {
    const templates = parse("  [US-EAST-2] ?.customHost ,\tus-west-2:?.otherHost ");

    expect(templates.get("us-east-2")?.host).toBe("?.customHost");
    expect(templates.get("us-west-2")?.host).toBe("?.otherHost");
  });

  it("rejects a custom domain with no region, since the region cannot be determined", () => {
    expect(() => parse("?.customHost")).toThrow(AwsWrapperError);
  });

  it("rejects an empty host pattern", () => {
    expect(() => parse("us-east-2:")).toThrow(AwsWrapperError);
  });

  it("rejects an empty region in brackets", () => {
    expect(() => parse("[]?.customHost")).toThrow(AwsWrapperError);
  });

  it("requires the property to be set", () => {
    expect(() => parse(null)).toThrow(AwsWrapperError);
    expect(() => parse("")).toThrow(AwsWrapperError);
  });

  it("keeps the last entry when a region repeats", () => {
    const templates = parse("us-east-2:?.first,us-east-2:?.second");

    expect(templates.size).toBe(1);
    expect(templates.get("us-east-2")?.host).toBe("?.second");
  });

  /*
    Region extraction delegates to getRdsRegion, so every partition that class supports must work in a
    bare pattern too. These previously failed: the China partition transposes the region and `rds`
    labels, and GovCloud / ISO region identifiers have four segments rather than three.
  */
  it.each([
    ["commercial", "?.abc123.us-east-2.rds.amazonaws.com", "us-east-2"],
    ["GovCloud", "?.abc123.us-gov-west-1.rds.amazonaws.com", "us-gov-west-1"],
    ["ISO", "?.abc123.us-iso-east-1.rds.amazonaws.com", "us-iso-east-1"],
    ["China", "?.abc123.rds.cn-northwest-1.amazonaws.com.cn", "cn-northwest-1"],
    ["China (legacy ordering)", "?.abc123.cn-north-1.rds.amazonaws.com.cn", "cn-north-1"]
  ])("infers the region from a bare %s endpoint pattern", (_partition, pattern, expectedRegion) => {
    const templates = parse(pattern);

    expect([...templates.keys()]).toEqual([expectedRegion]);
    expect(templates.get(expectedRegion)?.host).toBe(pattern);
  });

  it("accepts a four-segment region as an explicit colon prefix", () => {
    const templates = parse("us-gov-west-1:?.customHost,us-iso-east-1:?.otherHost");

    expect(templates.get("us-gov-west-1")?.host).toBe("?.customHost");
    expect(templates.get("us-iso-east-1")?.host).toBe("?.otherHost");
  });

  it("mixes partitions and forms in one value", () => {
    const templates = parse(
      "?.abc.us-east-2.rds.amazonaws.com,?.def.rds.cn-north-1.amazonaws.com.cn,[us-gov-west-1]?.govHost"
    );

    expect([...templates.keys()]).toEqual(["us-east-2", "cn-north-1", "us-gov-west-1"]);
  });

  it("treats a trailing numeric segment as a port, not a region", () => {
    // The disambiguation rule is "text after the first colon is not purely numeric", so this stays a
    // bare pattern and the region still comes from the endpoint.
    const templates = parse("?.abc.us-east-2.rds.amazonaws.com:5432");

    expect(templates.get("us-east-2")?.host).toBe("?.abc.us-east-2.rds.amazonaws.com:5432");
  });

  it("keeps a port alongside an explicit region prefix", () => {
    const templates = parse("us-east-2:?.customHost:9999");

    expect(templates.get("us-east-2")?.host).toBe("?.customHost:9999");
  });
});
