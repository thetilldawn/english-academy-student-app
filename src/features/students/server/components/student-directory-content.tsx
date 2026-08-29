import { emptyStudentDirectoryFilters } from "../../contracts/student-directory-read-model";
import { StudentDirectory } from "../../ui/student-directory";
import { getStudentDirectoryInitial } from "../queries/student-directory-query";

export async function StudentDirectoryContent() {
  const initialSnapshot = await getStudentDirectoryInitial(
    { filters: emptyStudentDirectoryFilters },
  );
  return <StudentDirectory initialSnapshot={initialSnapshot} />;
}
