import { useEffect, useId, useRef, useState } from "react";

import { companionApi } from "../api";
import { initials } from "../format";
import { useNotice } from "../hooks/useNotice";
import type { SafeUser } from "../types";
import { Notice } from "./Notice";

interface Props {
  user: SafeUser;
  /** An open Twitch prediction would be stranded by disconnecting, so it blocks it. */
  predictionOpen?: boolean;
  /** Called after Twitch is disconnected so the app can reload `get_me` and show onboarding. */
  onDisconnected: () => void;
}

export function AccountMenu({ user, predictionOpen = false, onDisconnected }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notice, showError, clear } = useNotice();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    item.current?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function disconnect() {
    setBusy(true);
    clear();
    try {
      await companionApi.disconnectTwitch();
      setOpen(false);
      onDisconnected();
    } catch (caught) {
      showError(String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          clear();
          setOpen((current) => !current);
        }}
      >
        {user.twitch_profile_image_url ? (
          <img className="account-avatar" src={user.twitch_profile_image_url} alt="" />
        ) : (
          <span className="account-avatar" aria-hidden="true">
            {initials(user.twitch_display_name)}
          </span>
        )}
        <span className="account-name">{user.twitch_login}</span>
        <span className="account-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="account-menu" id={menuId} role="menu" aria-label="Account">
          <button
            ref={item}
            type="button"
            role="menuitem"
            className="account-menu__item"
            disabled={busy || predictionOpen}
            onClick={() => void disconnect()}
          >
            Disconnect Twitch
          </button>
          {predictionOpen && (
            <p className="account-menu__error">Resolve or cancel the open prediction first.</p>
          )}
          <Notice notice={notice} />
        </div>
      )}
    </div>
  );
}
