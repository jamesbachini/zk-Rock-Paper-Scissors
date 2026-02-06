import { existsSync } from "fs";

export type ContractInfo = {
  memberPath: string;
  manifestPath: string;
  packageName: string;
  wasmName: string;
  wasmPath: string;
  envKey: string;
  bindingsOutDir: string;
  isMockHub: boolean;
};

export type ContractSelection = {
  contracts: ContractInfo[];
  unknown: string[];
  ambiguous: { target: string; matches: string[] }[];
};

function toWasmName(packageName: string): string {
  return packageName.replaceAll("-", "_");
}

function toEnvKey(packageName: string): string {
  return toWasmName(packageName).toUpperCase();
}

export async function getWorkspaceContracts(): Promise<ContractInfo[]> {
  const rootText = await Bun.file("Cargo.toml").text();
  const rootToml = Bun.TOML.parse(rootText) as any;
  const members = (rootToml?.workspace?.members ?? []) as string[];

  if (!Array.isArray(members) || members.length === 0) {
    throw new Error("No workspace members found in root Cargo.toml");
  }

  const contractMembers = members.filter((m) => typeof m === "string" && m.startsWith("contracts/"));
  if (contractMembers.length === 0) {
    throw new Error("No contract workspace members found (expected paths under contracts/)");
  }

  const infos: ContractInfo[] = [];
  for (const memberPath of contractMembers) {
    const manifestPath = `${memberPath}/Cargo.toml`;
    if (!existsSync(manifestPath)) {
      throw new Error(`Workspace member missing Cargo.toml: ${manifestPath}`);
    }

    const manifestText = await Bun.file(manifestPath).text();
    const manifestToml = Bun.TOML.parse(manifestText) as any;
    const packageName = manifestToml?.package?.name as string | undefined;
    if (!packageName) {
      throw new Error(`Missing [package].name in ${manifestPath}`);
    }

    const wasmName = toWasmName(packageName);
    const envKey = toEnvKey(packageName);

    infos.push({
      memberPath,
      manifestPath,
      packageName,
      wasmName,
      wasmPath: `target/wasm32v1-none/release/${wasmName}.wasm`,
      envKey,
      bindingsOutDir: `bindings/${wasmName}`,
      isMockHub: packageName === "mock-game-hub" || wasmName === "mock_game_hub",
    });
  }

  infos.sort((a, b) => {
    if (a.isMockHub && !b.isMockHub) return -1;
    if (!a.isMockHub && b.isMockHub) return 1;
    return a.packageName.localeCompare(b.packageName);
  });

  return infos;
}

function normalizeTarget(value: string): string {
  return value.trim().toLowerCase();
}

function contractTargetKeys(contract: ContractInfo): string[] {
  const memberBase = contract.memberPath.split("/").pop() ?? contract.memberPath;
  return [
    contract.packageName,
    contract.wasmName,
    contract.memberPath,
    memberBase,
  ].map(normalizeTarget);
}

export function selectContracts(
  contracts: ContractInfo[],
  targets: string[],
): ContractSelection {
  const normalizedTargets = targets.map(normalizeTarget).filter(Boolean);
  if (normalizedTargets.length === 0) {
    return { contracts, unknown: [], ambiguous: [] };
  }

  const selected = new Map<string, ContractInfo>();
  const unknown: string[] = [];
  const ambiguous: { target: string; matches: string[] }[] = [];

  for (const target of normalizedTargets) {
    const matches = contracts.filter((contract) =>
      contractTargetKeys(contract).includes(target),
    );

    if (matches.length === 0) {
      unknown.push(target);
      continue;
    }

    const uniqueMatches = Array.from(
      new Map(matches.map((contract) => [contract.packageName, contract])).values(),
    );

    if (uniqueMatches.length > 1) {
      ambiguous.push({
        target,
        matches: uniqueMatches.map((contract) => contract.packageName),
      });
      continue;
    }

    selected.set(uniqueMatches[0].packageName, uniqueMatches[0]);
  }

  return {
    contracts: contracts.filter((contract) => selected.has(contract.packageName)),
    unknown,
    ambiguous,
  };
}

export function listContractNames(contracts: ContractInfo[]): string {
  return contracts.map((contract) => contract.packageName).join(", ");
}
