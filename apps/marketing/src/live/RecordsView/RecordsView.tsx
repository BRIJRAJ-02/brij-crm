import { Badge, RecordChip, Table, TagList, type TableColumn } from '@crm/ui';
import { type DemoCompany, type DemoPerson, COMPANIES, MEMBERS } from '../data.ts';
import { ViewHeader } from '../ViewHeader/ViewHeader.tsx';
import styles from './RecordsView.module.css';

/** Props for RecordsView: the People table or the Companies table. */
export type RecordsViewProps =
  | {
      readonly object: 'people';
      readonly people: readonly DemoPerson[];
      /** The person to point out: one a booking just created, or one opened from a booking. */
      readonly highlightId?: string | undefined;
    }
  | { readonly object: 'companies'; readonly people: readonly DemoPerson[]; readonly highlightId?: undefined };

const PEOPLE_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: 'Name', isRowHeader: true },
  { id: 'company', label: 'Company' },
  { id: 'title', label: 'Job title' },
  { id: 'owner', label: 'Owner' },
  { id: 'tags', label: 'Tags' },
];

const COMPANY_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: 'Company', isRowHeader: true },
  { id: 'domain', label: 'Domain' },
  { id: 'industry', label: 'Industry' },
  { id: 'size', label: 'Employees' },
  { id: 'people', label: 'People', align: 'end' },
  { id: 'owner', label: 'Owner' },
];

/** A teammate as the owner chip shows them. */
function Owner({ id }: { readonly id: string }) {
  const member = MEMBERS.find((candidate) => candidate.id === id);
  return member === undefined ? null : (
    <RecordChip display={{ type: 'member', id: member.id, name: member.name }} isPlain />
  );
}

/** The live demo's People or Companies: the library's Table, with the app's chips and tags in its cells. */
export function RecordsView(props: RecordsViewProps) {
  const { people } = props;
  if (props.object === 'companies') {
    const cell = (company: DemoCompany, column: string) => {
      switch (column) {
        case 'name':
          return (
            <RecordChip
              display={{ objectId: 'companies', recordId: company.id, name: company.name, kind: 'company' }}
              isPlain
            />
          );
        case 'domain':
          return company.domain;
        case 'industry':
          return company.industry;
        case 'size':
          return company.size;
        case 'people':
          return String(people.filter((person) => person.companyId === company.id).length);
        case 'owner':
          return <Owner id={company.ownerId} />;
        default:
          return null;
      }
    };
    return (
      <div className={styles.root}>
        <ViewHeader icon="building" hue="yellow" title="Companies" count={COMPANIES.length} />
        <div className={styles.table}>
          <Table
            label="Companies"
            columns={COMPANY_COLUMNS}
            rows={COMPANIES}
            getRowId={(company) => company.id}
            renderCell={cell}
            isHeaderSticky
          />
        </div>
      </div>
    );
  }

  const cell = (person: DemoPerson, column: string) => {
    const company = COMPANIES.find((candidate) => candidate.id === person.companyId);
    switch (column) {
      case 'name':
        return (
          <span className={styles.name}>
            <RecordChip
              display={{ objectId: 'people', recordId: person.id, name: person.name, kind: 'person' }}
              isPlain
            />
            {person.isNew === true && <Badge text="New" tone="accent" isWhole />}
          </span>
        );
      case 'company':
        return company === undefined ? null : (
          <RecordChip display={{ objectId: 'companies', recordId: company.id, name: company.name, kind: 'company' }} />
        );
      case 'title':
        return person.title;
      case 'owner':
        return <Owner id={person.ownerId} />;
      case 'tags':
        return <TagList tags={person.tags} maxVisible={2} />;
      default:
        return null;
    }
  };
  return (
    <div className={styles.root}>
      <ViewHeader icon="users" hue="green" title="People" count={people.length} />
      <div className={styles.table}>
        <Table
          label="People"
          columns={PEOPLE_COLUMNS}
          rows={[...people].sort((a, b) => Number(b.id === props.highlightId) - Number(a.id === props.highlightId))}
          getRowId={(person) => person.id}
          renderCell={cell}
          isHeaderSticky
        />
      </div>
    </div>
  );
}
