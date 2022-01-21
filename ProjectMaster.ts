/*
* This is nodejs graphql Project Master 
* This entiry of Project database table
* This file use to save, get, update Project detail
* Here defiend Project table column name and tyape with relation of other tables
*/

import {Entity, ObjectIdColumn, Column, ObjectID, OneToOne, UpdateDateColumn, CreateDateColumn} from "typeorm";
import {ProjectMember} from "./ProjectMember";
import {TeamMember} from "./TeamMember";

@Entity()
export class ProjectMaster {

    @ObjectIdColumn()
    _id: number;

    @Column()
    projectId: string;

    @Column()
    name: string;

    @Column()
    purpose: string;

    @Column() 
    address: string;

    @Column()
    company: string;

    @Column()
    latitude: string;
    
    @Column()
    longitude: string;

    @Column()
    startDate: string;

    @Column()
    endDate: string;
    
    @Column() 
    projectmembers: [
        {
          ref: 'ProjectMember',
          type: ObjectID,
        },
      ]

    @Column()
    projectOwner: string

    @Column() 
    status: number

    @CreateDateColumn()
    created_at: Date;
}