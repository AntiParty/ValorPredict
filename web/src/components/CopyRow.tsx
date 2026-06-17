import { useState } from "react";

interface CopyRowProps {
  value: string;
  inputId?: string;
  label?: string;
}

export function CopyRow({ value, inputId, label = "Copy" }: CopyRowProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; leave the label unchanged.
    }
  }

  return (
    <div className="key-copy-row">
      <input id={inputId} type="text" readOnly value={value} />
      <button className="button button-light" type="button" onClick={handleCopy}>
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}
