import React from "react";

import {
  Box,
  Button,
  CircularProgress,
  Link as HyperLink,
  Stack,
  TextField,
} from "@mui/material";
import * as anchor from '@project-serum/anchor';
import {
  useWallet,
} from '@solana/wallet-adapter-react';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  AccountLayout,
} from '@solana/spl-token'
import {
  notify,
  useLocalStorageState,
  TOKEN_PROGRAM_ID,
} from '@oyster/common';
import BN from 'bn.js';

import {
  useConnection,
  Connection,
} from '../contexts';
import {
  COLLECTOOOOOORS_PREFIX,
  COLLECTOOOOOORS_PROGRAM_ID,
} from '../utils/ids';
import {
  explorerLinkFor,
} from '../utils/transactions';

export const BurnCrank = () => {
  const connection = useConnection();
  const wallet = useWallet();

  const anchorWallet = React.useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    } as anchor.Wallet;
  }, [wallet]);

  const [program, setProgram] = React.useState<anchor.Program | null>(null);

  React.useEffect(() => {
    if (!anchorWallet) {
      return;
    }

    const wrap = async () => {
      try {
        const provider = new anchor.Provider(connection, anchorWallet, {
          preflightCommitment: 'recent',
        });
        const idl = await anchor.Program.fetchIdl(COLLECTOOOOOORS_PROGRAM_ID, provider);

        const program = new anchor.Program(idl, COLLECTOOOOOORS_PROGRAM_ID, provider);
        setProgram(program);
      } catch (err) {
        console.error('Failed to fetch IDL', err);
      }
    };
    wrap();
  }, [anchorWallet]);

  const [recipe, setRecipe] = useLocalStorageState(
    "recipe",
    "",
  );

  const crank = async (recipeKey : PublicKey) => {
    if (!anchorWallet || !program) {
      throw new Error(`Wallet or program is not connected`);
    }

    let recipe;
    try {
      recipe = await program.account.recipe.fetch(recipeKey);
    } catch (err) {
      throw new Error(`Failed to find recipe ${recipeKey.toBase58()}`);
    }

    const dishAccounts = await connection.getProgramAccounts(
      COLLECTOOOOOORS_PROGRAM_ID,
      {
        filters: [
          {
            memcmp: {
              offset:
                8 + // discriminator
                32  // authority
                ,
              bytes: recipeKey.toBase58(),
            },
          },
        ],
      },
    );

    // TODO: getMultipleAccountsInfo?
    for (const dishAccount of dishAccounts) {
      const dish = await program.coder.accounts.decode(
          "Dish", dishAccount.account.data);
      console.log(dish);
      if (!dish.completed) continue;

      const dishKey = new PublicKey(dishAccount.pubkey);

      // TODO: separate on overflow
      const instrs : Array<TransactionInstruction> = [];
      for (let idx = 0; idx < recipe.roots.length; ++idx) {
        const ingredientNum = new BN(idx);
        const [storeKey, storeBump] = await PublicKey.findProgramAddress(
          [
            COLLECTOOOOOORS_PREFIX,
            dishKey.toBuffer(),
            Buffer.from(ingredientNum.toArray('le', 8)),
          ],
          COLLECTOOOOOORS_PROGRAM_ID,
        );

        const storeAccount = await connection.getAccountInfo(storeKey);
        if (storeAccount === null) {
          continue;
        }

        instrs.push(await program.instruction.consumeIngredient(
          storeBump,
          ingredientNum,
          {
            accounts: {
              recipe: recipeKey,
              dish: dishKey,
              ingredientMint: new PublicKey(AccountLayout.decode(storeAccount.data).mint),
              ingredientStore: storeKey,
              payer: anchorWallet.publicKey,
              systemProgram: SystemProgram.programId,
              tokenProgram: TOKEN_PROGRAM_ID,
            },
            signers: [],
            instructions: [],
          }
        ));
      }

      const crankResult = await Connection.sendTransactionWithRetry(
        program.provider.connection,
        anchorWallet,
        instrs,
        [],
      );

      console.log(crankResult);

      if (typeof crankResult === "string") {
        throw new Error(crankResult);
      } else {
        notify({
          message: `Crank succeeded for dish ${dishAccount.pubkey}`,
          description: (
            <HyperLink href={explorerLinkFor(crankResult.txid, connection)}>
              View transaction on explorer
            </HyperLink>
          ),
        });
      }
    }
  };

  const [loading, setLoading] = React.useState(false);
  const loadingProgress = () => (
    <CircularProgress
      size={24}
      sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: '-12px',
        marginLeft: '-12px',
      }}
    />
  );

  return (
    <Stack spacing={2}>
      <TextField
        id="recipe-field"
        label={`Recipe`}
        value={recipe}
        inputProps={{
          sx: { fontFamily: 'Monospace' }
        }}
        onChange={e => setRecipe(e.target.value)}
      />

      <Box sx={{ position: "relative" }}>
      <Button
        disabled={!anchorWallet || loading}
        variant="contained"
        style={{ width: "100%" }}
        onClick={() => {
          setLoading(true);
          const wrap = async () => {
            try {
              await crank(new PublicKey(recipe));
              setLoading(false);
            } catch (err) {
             notify({
                message: 'Burn crank failed',
                description: `${err}`,
              });
              setLoading(false);
            }
          };
          wrap();
        }}
      >
        Burn
      </Button>
      {loading && loadingProgress()}
      </Box>
    </Stack>
  );

};
