import { randomUUID } from "node:crypto";
import type { IntegrationContextDto, IntegrationRunContext } from "@traceforge/api";
import type { Pool } from "pg";

export class PostgresIntegrationContextRegistry {
  public constructor(private readonly pool:Pool){}
  public async ensure(input:IntegrationContextDto):Promise<IntegrationRunContext>{
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${input.adapter}:${input.externalSessionId}`]);
      const existing=await client.query<IntegrationRunContext>("SELECT task_id AS \"taskId\",session_id AS \"sessionId\",run_id AS \"runId\" FROM integration_run_contexts WHERE adapter=$1 AND external_session_id=$2",[input.adapter,input.externalSessionId]);
      if(existing.rows[0]){await client.query("COMMIT");return existing.rows[0];}
      const context={taskId:randomUUID(),sessionId:randomUUID(),runId:randomUUID()},now=new Date().toISOString();
      await client.query("INSERT INTO tasks(task_id,title,repository,workspace,created_at,created_by,status) VALUES($1,$2,$3,$4,$5,$6,'IN_PROGRESS')",[context.taskId,`OpenCode session ${input.externalSessionId}`,input.repository,input.workspace,now,input.developer]);
      await client.query("INSERT INTO sessions(session_id,task_id,started_at,developer,environment) VALUES($1,$2,$3,$4,$5::jsonb)",[context.sessionId,context.taskId,now,input.developer,JSON.stringify({adapter:input.adapter,externalSessionId:input.externalSessionId})]);
      await client.query("INSERT INTO agent_runs(run_id,session_id,agent_id,agent_name,agent_version,status,started_at) VALUES($1,$2,$3,$4,$5,'RUNNING',$6)",[context.runId,context.sessionId,input.adapter,input.agentName??input.adapter,input.agentVersion??"not_available",now]);
      await client.query("INSERT INTO integration_run_contexts(adapter,external_session_id,task_id,session_id,run_id) VALUES($1,$2,$3,$4,$5)",[input.adapter,input.externalSessionId,context.taskId,context.sessionId,context.runId]);
      await client.query("COMMIT");return context;
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}
