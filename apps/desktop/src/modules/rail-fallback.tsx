import { useNavigate } from "@tanstack/react-router";
import { Button, Widget } from "@wiseroutine/design";

/** Quiet guidance, not an “all clear” assertion: background reads may still
 * be loading or offline. The rail hides this whenever another card is visible. */
export const RailFallback: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="wr-rail-fallback">
      <Widget eyebrow="Your routine">
        <h3 className="wr-widget-title">Make a little room</h3>
        <p className="wr-body">
          A short walk, a stretch, or a few minutes of focus is a good place to
          start.
        </p>
        <p className="wr-body">
          Your next activity and anything needing attention will appear here.
          Select a block on your day to see its controls.
        </p>
        <Button
          block
          variant="secondary"
          onClick={() => void navigate({ to: "/activities" })}
        >
          Review activities
        </Button>
      </Widget>
    </div>
  );
};
