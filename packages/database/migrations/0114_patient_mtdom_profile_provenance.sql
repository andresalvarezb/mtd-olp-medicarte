-- Explicit source marker; only MTDOM is currently an approved technical source.
ALTER TABLE patients
  ADD COLUMN mtdom_basic_profile_source varchar(20),
  ADD COLUMN mtdom_personal_profile_source varchar(20),
  ADD CONSTRAINT patients_mtdom_profile_provenance_check CHECK (
    (mtdom_basic_profile_source IS NULL OR mtdom_basic_profile_source = 'MTDOM')
    AND (mtdom_personal_profile_source IS NULL OR mtdom_personal_profile_source = 'MTDOM')
    AND ((mtdom_basic_profile IS NULL) = (mtdom_basic_profile_source IS NULL))
    AND ((mtdom_personal_profile IS NULL) = (mtdom_personal_profile_source IS NULL))
  );
