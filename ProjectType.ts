/*
* This is nodejs graphql Project Response Type 
* This response type use to send Project Response with data
* Here defined which type in data we have send
*/

import {
    GraphQLID,
    GraphQLString,
    GraphQLObjectType,
    GraphQLInt,
    GraphQLBoolean,
    GraphQLList
} from "graphql";
import { ProjectMember } from "./ProjectMember";
import { InviteMember } from "../entity";

export const ProjectType = new GraphQLObjectType({
    name: 'project',
    fields: () => {
        return {
            _id: {
                type: GraphQLID
            },
            projectid: {
                type: GraphQLString
            },
            companytokenid: {
                type: GraphQLString
            },
            name: {
                type: GraphQLString
            },
            projectname: {
                type: GraphQLString
            },
            purpose: {
                type: GraphQLString
            },
            address: {
                type: GraphQLString
            },
            latitude: {
                type: GraphQLString
            },
            longitude: {
                type: GraphQLString
            },
            company: {
                type: GraphQLString
            },
            companyname: {
                type: GraphQLString
            },
            displayname: {
                type: GraphQLString
            },
            startDate: {
                type: GraphQLString
            },
            endDate: {
                type: GraphQLString
            },
            status: {
                type: GraphQLString
            },
            isclosed: {
                type: GraphQLBoolean
            },
            close_description: {
                type: GraphQLString
            },
            projectOwner: {
                type: GraphQLString
            },
            ownerid: {
                type: GraphQLString
            },
            current_user: {
                type: GraphQLString
            },
            current_userid: {
                type: GraphQLString
            },
            current_user_companylicenceid: {
                type: GraphQLString
            },
            current_user_licencename: {
                type: GraphQLString
            },
            attachments: {
                type: GraphQLString
            },
            project_member: {
                type: GraphQLList(projectMembers)
            },
            invite_member: {
                type: GraphQLList(inviteMembers)
            },
            active_member: {
                type: GraphQLList(activeMembers)
            },
            delete_member: {
                type: GraphQLList(deleteMembers)
            },
            created_at: {
                type: GraphQLString
            }
        }
    }
});
 
export const projectMembers = new GraphQLObjectType({
    name: 'projectmembers',
    fields: () => {
        return {
            name: {
                type: GraphQLString
            },
            projectid: {
                type: GraphQLString
            },
            userid: {
                type: GraphQLString
            },
            rolename: {
                type: GraphQLString
            },
            roleid: {
                type: GraphQLString
            },
            firebaseid: {
                type: GraphQLString
            },
            companyid: {
                type: GraphQLString
            },
            companyname: {
                type: GraphQLString
            },
            displayname: {
                type: GraphQLString
            },
            licenceid: {
                type: GraphQLString
            },
            licencename: {
                type: GraphQLString
            },
            companylicenceid: {
                type: GraphQLString
            },
            status: {
                type: GraphQLString
            },
            inviteid: {
                type: GraphQLString
            },
            created_at: {
                type: GraphQLString
            },
            email: {
                type: GraphQLString
            }
        }
    }
})


export const inviteMembers = new GraphQLObjectType({
    name: 'invitemembers',
    fields: () => {
        return {
            name: {
                type: GraphQLString
            },
            email: {
                type: GraphQLString
            },
            projectid: {
                type: GraphQLString
            },
            userid: {
                type: GraphQLString
            },
            rolename: {
                type: GraphQLString
            },
            roleid: {
                type: GraphQLString
            },
            firebaseid: {
                type: GraphQLString
            },
            companyid: {
                type: GraphQLString
            },
            companyname: {
                type: GraphQLString
            },
            displayname: {
                type: GraphQLString
            },
            licenceid: {
                type: GraphQLString
            },
            licencename: {
                type: GraphQLString
            },
            companylicenceid: {
                type: GraphQLString
            },
            status: {
                type: GraphQLString
            },
            inviteid: {
                type: GraphQLString
            },
            created_at: {
                type: GraphQLString
            }
        }
    }
})

export const activeMembers = new GraphQLObjectType({
    name: 'activemembers',
    fields: () => {
        return {
            name: {
                type: GraphQLString
            },
            email: {
                type: GraphQLString
            },
            projectid: {
                type: GraphQLString
            },
            userid: {
                type: GraphQLString
            },
            rolename: {
                type: GraphQLString
            },
            roleid: {
                type: GraphQLString
            },
            firebaseid: {
                type: GraphQLString
            },
            companyid: {
                type: GraphQLString
            },
            companyname: {
                type: GraphQLString
            },
            displayname: {
                type: GraphQLString
            },
            licenceid: {
                type: GraphQLString
            },
            licencename: {
                type: GraphQLString
            },
            companylicenceid: {
                type: GraphQLString
            },
            status: {
                type: GraphQLString
            },
            inviteid: {
                type: GraphQLString
            },
            created_at: {
                type: GraphQLString
            }
        }
    }
})

export const deleteMembers = new GraphQLObjectType({
    name: 'deletemembers',
    fields: () => {
        return {
            name: {
                type: GraphQLString
            },
            projectid: {
                type: GraphQLString
            },
            userid: {
                type: GraphQLString
            },
            rolename: {
                type: GraphQLString
            },
            roleid: {
                type: GraphQLString
            },
            firebaseid: {
                type: GraphQLString
            },
            companyid: {
                type: GraphQLString
            },
            companyname: {
                type: GraphQLString
            },
            displayname: {
                type: GraphQLString
            },
            licenceid: {
                type: GraphQLString
            },
            licencename: {
                type: GraphQLString
            },
            companylicenceid: {
                type: GraphQLString
            },
            status: {
                type: GraphQLString
            },
            inviteid: {
                type: GraphQLString
            },
            created_at: {
                type: GraphQLString
            }
        }
    }
})