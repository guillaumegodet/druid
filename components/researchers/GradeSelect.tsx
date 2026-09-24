import React from 'react';
import { GRADE_TYPOLOGY, findGradeByCode } from '../../lib/gradeTypology';
import { useLingui } from '@lingui/react/macro';

interface GradeSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
}

export const GradeSelect: React.FC<GradeSelectProps> = ({ value, onChange, disabled, className }) => {
  const { t } = useLingui();
  const isKnownCode = !value || !!findGradeByCode(value);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      <option value="">{t`— Undefined —`}</option>

      {/* Free value not recognized in the typology */}
      {!isKnownCode && (
        <option value={value} disabled style={{ fontStyle: 'italic' }}>
          {t`(Current value: ${value})`}
        </option>
      )}

      {GRADE_TYPOLOGY.map((cat) => (
        <React.Fragment key={cat.categorie}>
          {/* Category header (not selectable) */}
          <option disabled>▸ {cat.categorie}</option>

          {cat.sous_categories.map((scat) => (
            <optgroup key={scat.nom} label={`  ${scat.nom}`}>
              {scat.items.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} — {item.libelle}
                </option>
              ))}
            </optgroup>
          ))}
        </React.Fragment>
      ))}
    </select>
  );
};
