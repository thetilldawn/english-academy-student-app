create index assignment_units_assignment_dataset_idx
  on public.assignment_units (assignment_id, dataset_id);

create index assignment_units_unit_dataset_idx
  on public.assignment_units (unit_id, dataset_id);
