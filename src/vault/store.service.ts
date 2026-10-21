import {
  Injectable,
  ServiceUnavailableException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  BudgetEntry,
  CaseRecord,
  Category,
  ContentRecord,
  RunRecord,
  LegacyRecord,
} from "./models";
import { budgetMonth, toMicros } from "./policy";

@Injectable()
export class StoreService {
  private client?: SupabaseClient;
  private readonly activeRun = new AsyncLocalStorage<string>();
  withRun<T>(id: string, operation: () => Promise<T>) {
    return this.activeRun.run(id, operation);
  }

  configured() {
    return Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  db(): SupabaseClient {
    if (!this.configured())
      throw new ServiceUnavailableException(
        "Supabase 설정이 필요합니다. 설정 안내를 확인하세요.",
      );
    return (this.client ||= createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    ));
  }

  private error(error: { message: string } | null) {
    if (error) {
      if (
        /duplicate|concurrently|conflict|budget exceeded/i.test(error.message)
      )
        throw new ConflictException(error.message);
      throw new ServiceUnavailableException(
        "영구 저장소 작업에 실패했습니다. 설정·마이그레이션·연결을 확인하세요.",
      );
    }
  }

  async list<T>(table: string): Promise<T[]> {
    const records: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.db()
        .from(table)
        .select("data")
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 999);
      this.error(error);
      records.push(...(data || []).map((row) => row.data as T));
      if (!data || data.length < 1000) return records;
    }
  }

  cases() {
    return this.list<CaseRecord>("vault_cases");
  }
  contents() {
    return this.list<ContentRecord>("vault_content");
  }
  runs() {
    return this.list<RunRecord>("vault_runs");
  }
  history() {
    return this.list<LegacyRecord>("vault_legacy");
  }

  async historyReady() {
    const { data, error } = await this.db()
      .from("vault_settings")
      .select("key")
      .eq("key", "history-import")
      .maybeSingle();
    this.error(error);
    return Boolean(data);
  }

  async result(key: string) {
    const { data, error } = await this.db()
      .from("vault_results")
      .select("data")
      .eq("operation_key", key)
      .maybeSingle();
    this.error(error);
    return data?.data as
      { text: string; stopReason: string; cost: number } | undefined;
  }

  async saveResult(
    key: string,
    data: { text: string; stopReason: string; cost: number },
  ) {
    const { error } = await this.db()
      .from("vault_results")
      .insert({ operation_key: key, data });
    this.error(error);
  }

  async previousContents() {
    const [contents, history] = await Promise.all([
      this.contents(),
      this.history(),
    ]);
    return [
      ...contents,
      ...history.flatMap((item) =>
        item.mappedContent ? [item.mappedContent] : [],
      ),
    ];
  }

  async content(id: string): Promise<ContentRecord> {
    const { data, error } = await this.db()
      .from("vault_content")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    this.error(error);
    if (!data) throw new NotFoundException("콘텐츠를 찾을 수 없습니다.");
    return data.data as ContentRecord;
  }

  async case(id: string): Promise<CaseRecord> {
    const { data, error } = await this.db()
      .from("vault_cases")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    this.error(error);
    if (!data) throw new NotFoundException("사건을 찾을 수 없습니다.");
    return data.data as CaseRecord;
  }

  async saveCase(record: CaseRecord, previous: CaseRecord | null = null) {
    const { error } = await this.db().rpc("vault_save_case", {
      p_record: record,
      p_previous: previous,
    });
    this.error(error);
    return record;
  }

  async reserve(record: ContentRecord): Promise<ContentRecord> {
    const { data, error } = await this.db().rpc("vault_reserve_content", {
      p_record: record,
    });
    this.error(error);
    return data as ContentRecord;
  }

  async saveContent(record: ContentRecord): Promise<ContentRecord> {
    const { data, error } = await this.db().rpc("vault_update_content", {
      p_record: { ...record, updatedAt: new Date().toISOString() },
      p_revision: record.revision,
      p_run: this.activeRun.getStore() || null,
    });
    this.error(error);
    return data as ContentRecord;
  }

  async reserveCost(
    contentId: string,
    step: string,
    category: Category,
    maximumDollars: number,
  ): Promise<BudgetEntry> {
    const { data, error } = await this.db().rpc("vault_reserve_budget", {
      p_key: `${contentId}:${step}`,
      p_content: contentId,
      p_month: budgetMonth(),
      p_category: category,
      p_micros: toMicros(maximumDollars),
    });
    this.error(error);
    return data as BudgetEntry;
  }

  async settleCost(key: string, dollars: number, released = false) {
    const { error } = await this.db().rpc("vault_settle_budget", {
      p_key: key,
      p_spent: toMicros(dollars),
      p_state: released ? "released" : "settled",
    });
    this.error(error);
  }

  async budgets(): Promise<BudgetEntry[]> {
    const result: BudgetEntry[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.db()
        .from("vault_budget")
        .select("*")
        .order("created_at", { ascending: false })
        .order("operation_key")
        .range(offset, offset + 999);
      this.error(error);
      result.push(...(data || []));
      if (!data || data.length < 1000) return result;
    }
  }

  async trackProvider(key: string, taskId: string) {
    const { error } = await this.db()
      .from("vault_budget")
      .update({ provider_task_id: taskId })
      .eq("operation_key", key)
      .eq("state", "reserved");
    this.error(error);
  }

  async run(contentId: string, step: string): Promise<RunRecord> {
    const record: RunRecord = {
      id: randomUUID(),
      contentId,
      step,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    const { error } = await this.db().rpc("vault_start_run", {
      p_record: record,
    });
    this.error(error);
    return record;
  }

  async assertIdle(contentId: string) {
    const { data, error } = await this.db()
      .from("vault_runs")
      .select("id")
      .eq("content_id", contentId)
      .eq("data->>status", "running")
      .limit(1);
    this.error(error);
    if (data?.length)
      throw new ConflictException(
        "실행 중인 작업이 있습니다. 종료 또는 복구 후 수정하세요.",
      );
  }

  async saveRun(record: RunRecord) {
    const { error } = await this.db()
      .from("vault_runs")
      .upsert({ id: record.id, content_id: record.contentId, data: record });
    this.error(error);
  }
}
