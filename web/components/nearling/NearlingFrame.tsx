import type { ReactNode } from "react";
import css from "./nearling.module.css";

/**
 * The device body drawn in pixels (design.md section 5): bezel, 240x240 screen and the three
 * hardware buttons under it. `buttons` replaces the drawn buttons with real controls.
 */
export function NearlingFrame({
  children,
  buttons,
  label,
  screenClassName = "",
}: {
  children: ReactNode;
  buttons?: ReactNode;
  label: string;
  screenClassName?: string;
}) {
  return (
    <div className={`${css.bezel} inline-flex flex-col items-center gap-4 p-4`}>
      <div
        className={`${css.screen} relative flex h-[240px] w-[240px] items-end justify-center overflow-hidden pb-6 ${screenClassName}`}
        aria-label={label}
      >
        {children}
      </div>
      {buttons !== undefined ? buttons : (
        <div className="flex gap-3" aria-hidden>
          {["Talk", "Feed", "Menu"].map((b) => (
            <span key={b} className={css.hwBtn}>{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}
