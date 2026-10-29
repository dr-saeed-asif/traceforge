import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const SUI_TESTNET_GRPC_URL = "https://fullnode.testnet.sui.io:443";

export const suiDAppKit = createDAppKit({
  networks: ["testnet"],
  defaultNetwork: "testnet",
  autoConnect: true,
  storage: null,
  slushWalletConfig: null,
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: SUI_TESTNET_GRPC_URL })
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof suiDAppKit;
  }
}
