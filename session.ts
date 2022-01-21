/*
* This is nodejs graphql entity 
* This entiry of session/exprience database table
* This file use to save, get, update session/exprience detail
* Here defiend session/exprience table column name and tyape with relation of other tables
*/

import {Field, ID, ObjectType} from "type-graphql";
import {Column, Entity, PrimaryGeneratedColumn,OneToMany, JoinColumn, ManyToOne, OneToOne} from "typeorm";
import GraphQLJSON from 'graphql-type-json';
import {SessionParticipants, Users,Projects,Clips,SessionMarkers} from './index'
import {Thumbnails,bestMoments as keyMoments,contexBreakup,range, aggregate, stimulusClips, audience} from '../resolvers/types/index'
import * as moment from 'moment';
import { v4 as uuid4 } from 'uuid';
@ObjectType()
@Entity()
export class Sessions {
  @Field(type => ID)
  @PrimaryGeneratedColumn()
  session_id: number;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  created_at: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  updated_at: string;

  @Field({nullable: true})
  @Column({nullable: true})
  owner_user_id: number;

  @Field({nullable: true})
  @Column({nullable: true})
  session_title: string;

  @Field({nullable: true})
  @Column({nullable: true})
  session_description: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  started_at: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  ended_at: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  scheduled_start_at: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  scheduled_end_at: string;

  @Field({nullable: true})
  @Column({nullable: true})
  session_status: string;

  @Field({nullable: true})
  @Column({nullable: true})
  session_type: string;

  @Field({nullable: true})
  @Column({nullable: true})
  session_category: string;

  @Field({nullable: true})
  @Column({nullable: true})
  cancelled_at: string;

  @Field({nullable: true})
  @Column({nullable: true})
  active_at: string;

  @Field({nullable: true})
  @Column({nullable: true})
  deleted_at: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  completed_at: string;

  @Field(type => GraphQLJSON, {nullable: true})
  @Column({nullable: true})
  tag_cloud: string;

  @Field({nullable: true})
  @Column({nullable: true})
  background_stimulus_id: number;

  @Field({nullable: true})
  @Column({nullable: true})
  icon_stimulus_id: number;

  @Field({nullable: true})
  @Column({nullable: true})
  related_session_id: number;

  @Field({nullable: true})
  @Column({nullable: true})
  created_by: number;

  @Field({nullable: true})
  @Column({nullable: true})
  updated_by: number;

  @Field({nullable: true})
  @Column({nullable: true})
  session_code: string;

  @Field({ nullable: true })
  @Column({ default: false })
  enable_controls: boolean;

  @Field({ nullable: true })
  @Column({ default: true })
  enable_watermark: boolean;
  
  @Field(type => GraphQLJSON, {nullable: true})
  @Column("jsonb", {name: "reel_sessions", nullable: true})
  reel_sessions: object;

  @Field({nullable: true})
  @Column({nullable: true})
  project_id: number;

  @Field(type => GraphQLJSON, {nullable: true})
  @Column({nullable: true})
  agenda_json: string;

  @Field({nullable:true})
  @Column({nullable:true})
  session_subcategory:string

  @Field({nullable: true})
  @Column({nullable: true})
  customer_id: number;

  @Field({nullable: true})
  @Column({nullable: true})
  small_thumbnail: string;
  
  @Field({nullable: true})
  @Column({nullable: true})
  large_thumbnail: string;
  
  @Field({nullable: true})
  @Column({nullable: true})
  stimulus_status: string;
  
  @Field(type => GraphQLJSON, {nullable: true})
  @Column("jsonb", {name: "project_folders", nullable: true})
  project_folders: object;
  
  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  session_trim_from: string;
  @Field({nullable: true})

  @Column({
    transformer: {
      to: value => value,
      from: value => !!value ? moment(value).unix():null,
    },
  })
  session_trim_to: string;

  @Field({nullable: true})
  @Column({
    transformer: {
      to: value => uuid4(),
      from: value => value,
    },
  })
  session_link: string;
  
  @Field(type => [SessionParticipants],{nullable:true})
  @OneToMany(() => SessionParticipants, sessionParticipants => sessionParticipants.sessions)
  sessionParticipants?: Array<SessionParticipants>;
  
  @Field(type => GraphQLJSON, {nullable: true})
  stimulus:string[]
  
  @Field({nullable: true})
  owner_company: string;

  @Field({nullable: true})
  owner_first_name: string;
  
  @Field({nullable: true})
  owner_last_name: string;
  
  @Field({nullable: true})
  session_length: string;
  
  @Field({nullable: true})
  participantscount?: number;

  /* @Field(type=>[Clips],{nullable:true})
  stimulusclips: Clips[]; */

  @Field(type=>[stimulusClips],{nullable:true})
  stimulusclips: stimulusClips[];
  
  @Field(type=>[Thumbnails],{nullable:true})
  thumbnail: Thumbnails[];

  @Field(type=>aggregate,{nullable:true})
  safety_aggregate_index?: aggregate;
  
  //best key moment data type
  @Field(type=>[keyMoments],{nullable:true})
  best_moments?: keyMoments[];
  
  //worst key moment data type
  @Field(type=>[keyMoments],{nullable:true})
  worst_moments?: keyMoments[];

  //safety contex breakup
  @Field(type=>[contexBreakup],{nullable:true})
  safety_contex_breakup?: contexBreakup[];

  @Field(type=>[range],{nullable:true})
  safety_range?: range[];

  @Field({nullable:true})
  norm_imm?: number;

  @Field({nullable:true})
  norm_ps?: number;

  @Field({nullable:true})
  overall_safety_index?: number;
  
  @Field({nullable:true})
  large_thumbnail_base64?: string;
  
  @Field({nullable:true})
  small_thumbnail_base64?: string;

  @Field(type => Users, {nullable: true})
  @ManyToOne(() => Users, user => user.sessions)
  @JoinColumn({name: 'owner_user_id'})
  user: Users;
  
  @Field(type => Projects,{nullable:true})
  @OneToOne(() => Projects, projects => projects.sessions)
  @JoinColumn({name:"project_id"})
  projects: Projects;

  @Field(type => [SessionParticipants])
  @OneToMany(() => SessionParticipants, participants => participants.sessions)
  participant: SessionParticipants[];

  @Field(type => [SessionMarkers])
  @OneToMany(() => SessionMarkers, markers => markers.sessions)
  agenda_markers?: SessionMarkers[];

  @Field({nullable: true})
  @Column({nullable: true})
  braintrust_id: string;

  @Field({ nullable: true })
  @Column({ default: false})
  guest_only: boolean;

  @Field({ nullable: true })
  @Column({ default: false})
  no_guest: boolean;

  @Field({ nullable: true })
  @Column({ nullable: true})
  bt_type: string;

  @Field({ nullable: true })
  @Column({ default: false})
  enable_captivator: boolean;

  @Field({ nullable: true })
  @Column({ default: false})
  quicktest: boolean;
}
