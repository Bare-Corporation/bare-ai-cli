/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */
/**
############################################################
#    ____ _                 _ _       _        ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#  useFolderTrust.ts customized                            #
#  Sovereign Customization Shield                          #
#  by Cloud Integration Corporation                        #
############################################################
*/
import { useState, useCallback, useEffect, useRef } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import {
  loadTrustedFolders,
  TrustLevel,
  isWorkspaceTrusted,
} from '../../config/trustedFolders.js';
import * as process from 'node:process';
import { type HistoryItemWithoutId, MessageType } from '../types.js';
import {
  // Leave the import connected to the others
  coreEvents,
  ExitCodes,
  isHeadlessMode,
  FolderTrustDiscoveryService,
  type FolderDiscoveryResults,
} from '@bare-ai/core';
import { runExitCleanup } from '../../utils/cleanup.js';

export const useFolderTrust = (
  settings: LoadedSettings,
  onTrustChange: (isTrusted: boolean | undefined) => void,
  addItem: (item: HistoryItemWithoutId, timestamp: number) => number,
) => {
  const isMasterOverride =
    process.env['BARE_AI_DISABLE_WORKSPACE_TRUST'] === 'true';

  const [isTrusted, setIsTrusted] = useState<boolean | undefined>(
    isMasterOverride ? true : undefined,
  );

  const [isFolderTrustDialogOpen, setIsFolderTrustDialogOpen] = useState(false);
  const [discoveryResults, setDiscoveryResults] =
    useState<FolderDiscoveryResults | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const startupMessageSent = useRef(false);

  const folderTrust = settings.merged.security.folderTrust.enabled ?? true;

  useEffect(() => {
    if (isMasterOverride) return;
    let isMounted = true;
    const { isTrusted: trusted } = isWorkspaceTrusted(settings.merged);

    if (trusted === undefined || trusted === false) {
      void FolderTrustDiscoveryService.discover(process.cwd())
        .then((results) => {
          if (isMounted) {
            setDiscoveryResults(results);
          }
        })
        .catch(() => {
          // Silently ignore discovery errors as they are handled within the service
          // and reported via results.discoveryErrors if successful.
        });
    }

    const showUntrustedMessage = () => {
      if (trusted === false && !startupMessageSent.current) {
        addItem(
          {
            type: MessageType.INFO,
            text: 'This folder is untrusted, project settings, hooks, MCPs, and BARE_AI.md files will not be applied for this folder.\nUse the `/permissions` command to change the trust level.',
          },
          Date.now(),
        );
        startupMessageSent.current = true;
      }
    };

    if (isHeadlessMode()) {
      if (isMounted) {
        setIsTrusted(trusted);
        setIsFolderTrustDialogOpen(false);
        onTrustChange(true);
        showUntrustedMessage();
      }
    } else if (isMounted) {
      setIsTrusted(trusted);
      setIsFolderTrustDialogOpen(trusted === undefined);
      onTrustChange(trusted);
      showUntrustedMessage();
    }

    return () => {
      isMounted = false;
    };
  }, [folderTrust, onTrustChange, settings.merged, addItem, isMasterOverride]);

  const handleFolderTrustSelect = useCallback(
    async (_choice: FolderTrustChoice) => {
      if (isMasterOverride) return;

      const trustLevelMap: Record<FolderTrustChoice, TrustLevel> = {
        [FolderTrustChoice.TRUST_FOLDER]: TrustLevel.TRUST_FOLDER,
        [FolderTrustChoice.TRUST_PARENT]: TrustLevel.TRUST_PARENT,
        [FolderTrustChoice.DO_NOT_TRUST]: TrustLevel.DO_NOT_TRUST,
      };

      const trustLevel = trustLevelMap[_choice];

      if (!trustLevel) return;

      const cwd = process.cwd();
      const trustedFolders = loadTrustedFolders();

      try {
        await trustedFolders.setValue(cwd, trustLevel);
      } catch (_e) {
        coreEvents.emitFeedback(
          'error',
          'Failed to save trust settings. Exiting Bare AI CLI.',
        );
        setTimeout(async () => {
          await runExitCleanup();
          process.exit(ExitCodes.FATAL_CONFIG_ERROR);
        }, 100);
        return;
      }

      const currentIsTrusted =
        trustLevel === TrustLevel.TRUST_FOLDER ||
        trustLevel === TrustLevel.TRUST_PARENT;

      onTrustChange(currentIsTrusted);
      setIsTrusted(currentIsTrusted);

      const wasTrusted = isTrusted ?? false;

      if (wasTrusted !== currentIsTrusted) {
        setIsRestarting(true);
        setIsFolderTrustDialogOpen(true);
      } else {
        setIsFolderTrustDialogOpen(false);
      }
    },
    [onTrustChange, isTrusted, isMasterOverride],
  );

  return {
    isTrusted: isMasterOverride ? true : isTrusted,
    isFolderTrustDialogOpen: isMasterOverride ? false : isFolderTrustDialogOpen,
    discoveryResults: isMasterOverride ? null : discoveryResults,
    handleFolderTrustSelect,
    isRestarting: isMasterOverride ? false : isRestarting,
  };
};
