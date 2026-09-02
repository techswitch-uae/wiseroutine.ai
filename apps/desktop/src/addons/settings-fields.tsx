import { isShown, type SettingField } from "@wiseroutine/addons";
import { Field, SelectField, Toggle } from "@wiseroutine/design";

/**
 * A settings schema, drawn with the app's own fields.
 *
 * Used for an activity type's settings in the activity form and for an
 * addon's own settings on the Addons page. The addon never draws these.
 *
 * `secret` fields are drawn only when `secrets` is given: the value is
 * written through `secrets.set` and never enters `value`.
 */
export const SettingsFields: React.FC<{
  fields: readonly SettingField[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  secrets?: {
    /** Which secret keys already hold a value. */
    present: readonly string[];
    set: (key: string, value: string) => void;
  };
}> = ({ fields, value, onChange, secrets }) => (
  <>
    {fields.map((field) => {
      if (!isShown(field, value)) return null;
      const current = value[field.key];
      const help = field.help ? <Help key="help">{field.help}</Help> : null;

      switch (field.type) {
        case "select":
          return (
            <div key={field.key}>
              <SelectField
                label={field.label}
                options={[...field.options]}
                value={String(current)}
                onChange={(event) =>
                  onChange({ ...value, [field.key]: event.target.value })
                }
              />
              {help}
            </div>
          );
        case "number":
          return (
            <div key={field.key}>
              <Field
                type="number"
                label={field.label}
                value={String(current)}
                {...(field.min !== undefined ? { min: field.min } : {})}
                {...(field.max !== undefined ? { max: field.max } : {})}
                onChange={(event) => {
                  // Clamped on the way in. A typed 999 sails past the
                  // input's own min and max.
                  const typed = Number(event.target.value);
                  const next = Number.isFinite(typed) ? typed : field.default;
                  onChange({
                    ...value,
                    [field.key]: Math.min(
                      field.max ?? Number.POSITIVE_INFINITY,
                      Math.max(field.min ?? Number.NEGATIVE_INFINITY, next),
                    ),
                  });
                }}
              />
              {help}
            </div>
          );
        case "text":
          return (
            <div key={field.key}>
              <Field
                label={field.label}
                value={String(current)}
                {...(field.placeholder
                  ? { placeholder: field.placeholder }
                  : {})}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [field.key]: event.target.value.slice(
                      0,
                      field.maxLength ?? 500,
                    ),
                  })
                }
              />
              {help}
            </div>
          );
        case "boolean":
          return (
            <div key={field.key}>
              <Toggle
                label={field.label}
                checked={current === true}
                onChange={(next) => onChange({ ...value, [field.key]: next })}
              />
              {help}
            </div>
          );
        case "secret": {
          if (!secrets) return null;
          const set = secrets.present.includes(field.key);
          return (
            <div key={field.key}>
              <Field
                type="password"
                label={field.label}
                // Never shown back. A saved secret is an empty field with a
                // note under it.
                value=""
                placeholder={
                  set ? "Saved on this device" : (field.placeholder ?? "")
                }
                onChange={(event) => secrets.set(field.key, event.target.value)}
              />
              {help}
            </div>
          );
        }
        default:
          return null;
      }
    })}
  </>
);

const Help: React.FC<{ children: string }> = ({ children }) => (
  <p className="wr-body" style={{ margin: "4px 0 0", opacity: 0.7 }}>
    {children}
  </p>
);
