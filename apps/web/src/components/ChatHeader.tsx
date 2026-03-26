import {
  EDITORS,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { ChevronDownIcon, DiffIcon, FolderClosedIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { readNativeApi } from "~/nativeApi";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";

import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../keybindings";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Toggle } from "./ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Group, GroupSeparator } from "./ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "./ui/menu";
import { SidebarTrigger } from "./ui/sidebar";
import GitActionsControl from "./GitActionsControl";
import ProjectScriptsControl, { type NewProjectScriptInput } from "./ProjectScriptsControl";
import { CursorIcon, type Icon, VisualStudioCode, Zed } from "./Icons";

const LAST_EDITOR_KEY = "t3code:last-editor";

const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const [lastEditor, setLastEditor] = useState<EditorId>(() => {
    const stored = localStorage.getItem(LAST_EDITOR_KEY);
    return EDITORS.some((entry) => entry.id === stored) ? (stored as EditorId) : EDITORS[0].id;
  });

  const allOptions = useMemo<Array<{ label: string; Icon: Icon; value: EditorId }>>(
    () => [
      { label: "Cursor", Icon: CursorIcon, value: "cursor" },
      { label: "VS Code", Icon: VisualStudioCode, value: "vscode" },
      { label: "Zed", Icon: Zed, value: "zed" },
      {
        label: isMacPlatform(navigator.platform)
          ? "Finder"
          : isWindowsPlatform(navigator.platform)
            ? "Explorer"
            : "Files",
        Icon: FolderClosedIcon,
        value: "file-manager",
      },
    ],
    [],
  );
  const options = useMemo(
    () => allOptions.filter((option) => availableEditors.includes(option.value)),
    [allOptions, availableEditors],
  );
  const effectiveEditor = options.some((option) => option.value === lastEditor)
    ? lastEditor
    : (options[0]?.value ?? null);
  const primaryOption = options.find((option) => option.value === effectiveEditor) ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readNativeApi();
      if (!api || !openInCwd) {
        return;
      }
      const editor = editorId ?? effectiveEditor;
      if (!editor) {
        return;
      }
      void api.shell.openInEditor(openInCwd, editor);
      localStorage.setItem(LAST_EDITOR_KEY, editor);
      setLastEditor(editor);
    },
    [effectiveEditor, openInCwd],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const api = readNativeApi();
      if (!isOpenFavoriteEditorShortcut(event, keybindings)) {
        return;
      }
      if (!api || !openInCwd || !effectiveEditor) {
        return;
      }

      event.preventDefault();
      void api.shell.openInEditor(openInCwd, effectiveEditor);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [effectiveEditor, keybindings, openInCwd]);

  return (
    <Group aria-label="Subscription actions">
      <Button
        size="xs"
        variant="outline"
        disabled={!effectiveEditor || !openInCwd}
        onClick={() => openInEditor(effectiveEditor)}
      >
        {primaryOption?.Icon ? (
          <primaryOption.Icon aria-hidden="true" className="size-3.5" />
        ) : null}
        <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
          Open
        </span>
      </Button>
      <GroupSeparator className="hidden @sm/header-actions:block" />
      <Menu>
        <MenuTrigger render={<Button aria-label="Copy options" size="icon-xs" variant="outline" />}>
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 ? <MenuItem disabled>No installed editors found</MenuItem> : null}
          {options.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => openInEditor(value)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
              {value === effectiveEditor && openFavoriteEditorShortcutLabel ? (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              ) : null}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});

export interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
}: ChatHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName ? (
          <Badge variant="outline" className="max-w-28 shrink-0 truncate">
            {activeProjectName}
          </Badge>
        ) : null}
        {activeProjectName && !isGitRepo ? (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        ) : null}
      </div>
      <div className="@container/header-actions flex min-w-0 flex-1 items-center justify-end gap-2 @sm/header-actions:gap-3">
        {activeProjectScripts ? (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        ) : null}
        {activeProjectName ? (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        ) : null}
        {activeProjectName ? (
          <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
