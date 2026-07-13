import StewardLogo from "@/browser/assets/logos/white-steward.svg";

export function LoadingScreen(props: { statusText?: string }) {
  // Keep the outer markup/classes in sync with index.html's boot loader so
  // the transition from the raw HTML placeholder to React is seamless.
  return (
    <div className="boot-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="boot-loader__inner">
        <img src={StewardLogo} className="boot-loader__logo" alt="" data-testid="steward-logo" />
        <p className="boot-loader__text">
          {props.statusText ?? "Loading Steward"}
          {/* Animated "..." dots — only for default text; custom statusText
              (e.g. "Reconnecting...") supplies its own punctuation. CSS in
              index.html drives the animation via boot-loader__dots::after. */}
          {!props.statusText && <span className="boot-loader__dots" />}
        </p>
      </div>
    </div>
  );
}
