/*
* This is our main logic file
* Here code of save project, update project, list project
* This is graphql resolver, here grapql query and mutation
*/

import {
  GraphQLString,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLInt,
  GraphQLBoolean,
} from "graphql";
const { getConnection, getConnectionManager } = require("typeorm");
const conn = require("../connection");
import {
  ProjectMember,
  TeamMember,
  Project,
  Member,
  CompanyRequest,
  Licence,
  Invite,
  InviteMember,
  User,
  ProjectRequest,
  CampaignMaster,
  ProjectToken,
  NotificationMaster,
  NotificationSettings,
  NotificationTemplate,
  EmailSettings,
  EmailTemplate,
  CampaignInvite,
  ProbingMaster,
  ProbingTodoLog,
} from "../entity";
import {
  ProjectType,
  MemberType,
  CompanyType,
  LicenceType,
  InviteType,
  InviteMemberType,
  ProjectMember as ProjectMemberType,
  MemberDetailType,
  DocumentType,
  DocumentInfoType,
  ProjectTokenType,
  NotificationType,
} from "../responseSchema/index";
import { encode, decode } from "../../crypto/decrypt";
const { verifyToken } = require("../../constants/verify");
const { errorName } = require("../../constants/errorConstants");
const { notificationMessage } = require("../../constants/notification");
const { getCommonConnection } = require("./getCommonConnection");
const { systemLog } = require("./systemLog");
const { msgName, msgDetail } = require("../../constants/logMsgConstants");
const uuidv4 = require("uuid/v4");
import { firebase_config } from "../firebaseConfig";
const db = firebase_config().database();
const auth = firebase_config().auth();
const axios = require("axios");
const path = require("path");
const asyncLoop = require("node-async-loop");
const moment = require("moment");
import { Transporter } from "../../constants/transporter";
const filter = require("array.filter");


/**
 * Create project
 */
export const createProject = {
  type: ProjectType,
  args: {
    companytokenid: {
      type: new GraphQLNonNull(GraphQLString),
    },
    name: {
      type: new GraphQLNonNull(GraphQLString),
    },
    purpose: {
      type: new GraphQLNonNull(GraphQLString),
    },
    address: {
      type: new GraphQLNonNull(GraphQLString),
    },
    latitude: {
      type: new GraphQLNonNull(GraphQLString),
    },
    longitude: {
      type: new GraphQLNonNull(GraphQLString),
    },
    company: {
      type: new GraphQLNonNull(GraphQLString),
    },
    startDate: {
      type: new GraphQLNonNull(GraphQLString),
    },
    endDate: {
      type: new GraphQLNonNull(GraphQLString),
    },
    projectmembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
    teammembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
    projectOwner: {
      type: new GraphQLNonNull(GraphQLString),
    },
    outsidemembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
    ownerid: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        const log_userid = context.request.body.authdata.userid;
        
        const connection = await conn.on(args.company);
        const projectRepository = await connection.getRepository(Project);
        let userEmail = context.request.body.authdata.email;

        const cmpMemberRepository = await connection.getRepository(Member);
        const projectTokenRepository = await connection.getRepository(
          ProjectToken
        );
        let NotificationSettingsRepo = await connection.getRepository(
          NotificationSettings
        );
        let EmailSettingsRepo = await connection.getRepository(EmailSettings);

        const masterConnection = await conn.on(process.env.DB_DEFAULT);

        const notificationRepository = await masterConnection.getRepository(
          NotificationMaster
        );
        const NotificationTemplateRepo = await masterConnection.getRepository(
          NotificationTemplate
        );
        const EmailTemplateRepo = await masterConnection.getRepository(
          EmailTemplate
        );

        let Pro_dtl = await projectRepository.findOne({
          projectstatus: "active",
          name: args.name,
        });
        if (Pro_dtl) {
          return reject({ ErrorName: errorName.DUPLICATE_PROJECT_ERROR });
        }
        let tokenDetail = await projectTokenRepository.findOne({
          companytokenid: args.companytokenid,
          used: false,
        });
        if (!tokenDetail) {
          return reject({ ErrorName: errorName.PROJECTTOKEN_ERROR });
        }

        let userDetail = await cmpMemberRepository.findOne({
          email: userEmail,
        });
        const licenceRepository = await connection.getRepository(Licence);

        let projectMembers = JSON.parse(decode(args.projectmembers));
        let inviteMembers = JSON.parse(decode(args.teammembers));
        let outsideMembers = JSON.parse(decode(args.outsidemembers));
        let isUserEmail = 0;
        let isPromoterRole = 0;

        if (outsideMembers.length > 0) {
          asyncLoop(outsideMembers, async function (val, next) {
            if (val.roleid == "AXD_RL_02") {
              isPromoterRole = 1;
            }
            next();
          });
        }

        if (projectMembers.length > 0) {
          asyncLoop(projectMembers, async function (val, next) {
            if (val.roleid == "AXD_RL_02") {
              isPromoterRole = 1;
              if (val.licenceId == "") {
                return reject({ ErrorName: errorName.LICENCESELECT_ERROR });
              }
              isUserEmail = 0;
            }
            if (isPromoterRole == 0) {
              if (userDetail.userid == val.userId) {
                if (val.roleid != "AXD_RL_02") {
                  isUserEmail = 1;
                }
              }
            }
            next();
          });
        }
        if (inviteMembers.length > 0) {
          asyncLoop(inviteMembers, async function (val, next) {
            if (val.roleid == "AXD_RL_02") {
              isPromoterRole = 1;
            }
            next();
          });
        }
        if (isUserEmail == 1) {
          return reject({ ErrorName: errorName.PROJECT_PROMOTER_ERROR });
        }

        let data = {
          projectid: uuidv4(),
          companytokenid: args.companytokenid,
          name: args.name,
          purpose: args.purpose,
          address: args.address,
          latitude: args.latitude,
          longitude: args.longitude,
          company: args.company,
          startDate: args.startDate,
          endDate: args.endDate,
          ownerid: args.ownerid,
          status: 0,
          projectOwner: args.projectOwner,
          isclosed: false,
        };

        const project = await projectRepository.create(data);
        const result = await projectRepository.save(project);

        const memberRepository = await connection.getRepository(ProjectMember);
        let firebaseObject = [];
        if (result) {
          let message = msgDetail.CREATE_PROJECT.replace(
            "{{project_name}}",
            args.name
          );
          let logsData = {
            userid: log_userid,
            email: "",
            companyname: args.company,
            action: msgName.CREATE_PROJECT,
            detail: message,
            dbName: args.company,
          };
          systemLog(logsData);

          if (outsideMembers.length > 0) {
            
            const masterConnection = await conn.on(process.env.DB_DEFAULT);
            for (let val of outsideMembers) {
              if (val.roleid == "AXD_RL_02") {
                isPromoterRole = 1;
              }
              const userRepo = await masterConnection.getRepository(User);
              let checkUser = await userRepo.find({ email: val.email });

              if (checkUser.length === 0) {
                let data = {
                  email: val.email,
                  projectid: project.projectid,
                  projectname: project.name,
                  projectowner: project.projectOwner,
                  inviteid: val.inviteid,
                  roleid: val.roleid,
                  rolename: val.rolename,
                  senderid: val.sendercompanyname,
                  receiverid: null,
                  displayname: val.senderdisplayname,
                  companyname: null,
                  status: "request",
                };
                const projectReqRepo = await masterConnection.getRepository(
                  ProjectRequest
                );
                const outsideUser = await projectReqRepo.create(data);
                const user = await projectReqRepo.save(outsideUser);
                if (user) {
                  let projectmemberdata = {
                    projectid: project.projectid,
                    roleid: val.roleid,
                    rolename: val.rolename,
                    status: "request",
                    inviteid: val.inviteid,
                  };
                  let savedata = await memberRepository.create(
                    projectmemberdata
                  );
                  let saveProMember = await memberRepository.save(savedata);

                  if (saveProMember) {
                    const mailOptions = {
                      from: process.env.ADMIN_EMAIL,
                      to: val.email,
                      subject: "Welcome to Aexdo.",
                      html:
                        "<p>" + process.env.FE_URL + "/register?email=" +
                        val.email +
                        "</p>",
                    };
                    Transporter.sendMail(mailOptions, async (error, info) => {
                      if (error) {
                        console.log(error);
                      } else {
                        console.log("Email sent: " + info.response);
                      }
                    });
                  }
                }
              }
            }
          }

          if (projectMembers.length > 0) {
            let members = [];
            let licences = [];
            let checkLicence = [];
            let count = 0;
            for (let pr = 0; pr < projectMembers.length; pr++) {
              let val = projectMembers[pr];
              if (val.roleid == "AXD_RL_02") {
                isPromoterRole = 1;
              }
              let companylicenceid = "";
              let licence;
              if (val.licenceId != "") {
                licence = await licenceRepository.findOne({
                  used: false,
                  licenceid: val.licenceId,
                });
                if (!licence) {
                  return reject({ ErrorName: errorName.LICENCELIST_ERROR });
                }
                companylicenceid = licence.companylicenceid;
              }

              let data = {
                projectid: result.projectid,
                name: val.name,
                userid: val.userId,
                firebaseid: val.firbaseId,
                companyid: val.companyId,
                companyname: val.companyname,
                displayname: val.displayname,
                roleid: val.roleid,
                rolename: val.rolename,
                licenceid: val.licenceId,
                licencename: val.licencename,
                companylicenceid: companylicenceid,
                status: "approve",
                inviteid: null,
              };

              let member = await memberRepository.create(data);
              let res = await memberRepository.save(member);
              if (res) {
                if (companylicenceid != "") {
                  let updateLicence = await licenceRepository.update(
                    { companylicenceid: companylicenceid },
                    { used: true }
                  );
                }

                //Send Email To Project members
                let ProuserDtl = await cmpMemberRepository.findOne({
                  userid: val.userId,
                });
                if (ProuserDtl.email) {
                  const mailOptions = {
                    from: process.env.ADMIN_EMAIL,
                    to: ProuserDtl.email,
                    subject: "Project Assign",
                    html:
                      "<p>Hello,</p><br/><p>You have been assigned in :" +
                      args.name +
                      "</p>",
                  };
                }
              }
              
            }

            let noti_data = await NotificationTemplateRepo.findOne({
              key: "ADD_IN_PROJECT",
            });
            asyncLoop(
              projectMembers,
              async function (val, next) {
                await members.push({
                  projectid: result.projectid,
                  name: val.name,
                  userid: val.userId,
                  firebaseid: val.firbaseId,
                  companyid: val.companyId,
                  companyname: val.companyname,
                  displayname: val.displayname,
                  roleid: val.roleid,
                  rolename: val.rolename,
                  licenceid: val.licenceId,
                  licencename: val.licencename,
                  status: "approve",
                  inviteid: null,
                });

                //send Notification
                let noti_set = await NotificationSettingsRepo.findOne({
                  userid: val.userId,
                  key: "ADD_IN_PROJECT",
                });
                if (!noti_set || !noti_set.isdisable) {
                  let addMessage = notificationMessage.ADD_IN_PROJECT;
                  if (noti_data) {
                    addMessage = noti_data.description;
                  }

                  let message = addMessage.replace(
                    "{{project_name}}",
                    args.name
                  );
                  let notificationMess = {
                    key: "ADD_IN_PROJECT",
                    senderid: log_userid,
                    projectid: result.projectid,
                    companyid: val.companyId,
                    companyname: val.companyname,
                    displayname: val.displayname,
                    message: message,
                    read: false,
                  };
                  let notiData = await notificationRepository.create({
                    userid: val.userId,
                    notifications: notificationMess,
                  });
                  await notificationRepository.save(notiData);
                }

                let email_set = await EmailSettingsRepo.findOne({
                  userid: val.userId,
                  key: "user_added_to_project",
                });
                if (!email_set || !email_set.isdisable) {
                  let email_data = await EmailTemplateRepo.findOne({
                    key: "user_added_to_project",
                  });
                  if (email_data) {
                    let ProuserDtl = await cmpMemberRepository.findOne({
                      userid: val.userId,
                    });
                    if (ProuserDtl.email) {
                      let mailOptions = {
                        from: process.env.ADMIN_EMAIL,
                        to: ProuserDtl.email,
                        subject: email_data.subject,
                        html: email_data.description,
                      };

                      Transporter.sendMail(mailOptions, async (error, info) => {
                        if (error) {
                          console.log(error);
                        } else {
                          console.log("Email sent: " + info.response);
                        }
                      });
                    }
                  }
                }
                next();
              },
              function (err) {
                if (err) {
                  console.error("Error: " + err.message);
                  return;
                }
              }
            );

            Object.assign(result, { project_member: members });
            members.map((val, index) => {
              firebaseObject[val.firebaseid] = 0;
            });
            await db
              .ref("projects/" + result.projectid + "/unreadcount")
              .set(firebaseObject);
          }

          if (inviteMembers.length > 0) {
            inviteMembers.map(async (val, index) => {
              if (val.roleid == "AXD_RL_02") {
                isPromoterRole = 1;
              }
              let invites = {
                projectid: result.projectid,
                projectname: result.name,
                projectowner: result.projectOwner,
                receiverid: val.companyname,
                senderid: context.request.body.authdata.companyname,
                roleid: val.roleid,
                rolename: val.rolename,
                status: val.status,
                displayname: val.senderdisplayname,
                companyname: val.companyname,
                inviteid: val.inviteId,
              };

              const inviteConnection = await conn.on(val.companyname);
              const inviteRepository = await inviteConnection.getRepository(
                Invite
              );
              const memberInviteRepository = await inviteConnection.getRepository(
                Member
              );

              let cmpNotificationSettingsRepo = await connection.getRepository(
                NotificationSettings
              );
              let cmpEmailSettingsRepo = await connection.getRepository(
                EmailSettings
              );

              const invite = await inviteRepository.create(invites);
              const saveInvite = await inviteRepository.save(invite);

              let memberDetail = await memberInviteRepository.findOne({
                company_name: val.companyname,
                system_flag: true,
              });

              //send Notification
              let noti_data = await NotificationTemplateRepo.findOne({
                key: "PROJECT_MEMBER_REQ",
              });
              let noti_set = await cmpNotificationSettingsRepo.findOne({
                userid: memberDetail.userid,
                key: "PROJECT_MEMBER_REQ",
              });
              if (!noti_set || !noti_set.isdisable) {
                let addMessage = notificationMessage.PROJECT_MEMBER_REQ;
                if (noti_data) {
                  addMessage = noti_data.description;
                }
                let message = addMessage.replace(
                  "{{company_name}}",
                  val.senderdisplayname
                );
                let notificationMess = {
                  key: "PROJECT_MEMBER_REQ",
                  senderid: log_userid,
                  projectid: result.projectid,
                  companyid: memberDetail.company_id,
                  companyname: memberDetail.company_name,
                  displayname: memberDetail.display_name,
                  message: message,
                  read: false,
                };

                let notiData = await notificationRepository.create({
                  userid: memberDetail.userid,
                  notifications: notificationMess,
                });
                await notificationRepository.save(notiData);
              }

              let email_set = await cmpEmailSettingsRepo.findOne({
                userid: memberDetail.userid,
                key: "project_request",
              });
              if (!email_set || !email_set.isdisable) {
                let email_data = await EmailTemplateRepo.findOne({
                  key: "project_request",
                });
                if (email_data) {
                  let mailOptions = {
                    from: process.env.ADMIN_EMAIL,
                    to: memberDetail.email,
                    subject: email_data.subject,
                    html: email_data.description,
                  };

                  Transporter.sendMail(mailOptions, async (error, info) => {
                    if (error) {
                      console.log(error);
                    } else {
                      console.log("Email sent: " + info.response);
                    }
                  });
                }
              }
            });
          }

          if (inviteMembers.length > 0) {
            let invites = [];
            inviteMembers.map(async (val, index) => {
              let requests = {
                projectid: result.projectid,
                name: null,
                userid: null,
                firebaseid: null,
                companyid: val.companyId,
                companyname: val.companyname,
                displayname: val.displayname,
                roleid: val.roleid,
                rolename: val.rolename,
                licenceid: null,
                licencename: null,
                status: val.status,
                inviteid: val.inviteId,
              };

              invites.push({
                companyname: val.companyname,
                rolename: val.rolename,
              });
              const memberRepository = await connection.getRepository(
                ProjectMember
              );
              const request = await memberRepository.create(requests);
              const saveRequest = await memberRepository.save(request);
            });
            Object.assign(result, { invite_member: invites });
          }

          if (isPromoterRole == 0) {
            
            let data = {
              projectid: result.projectid,
              name: userDetail.name,
              userid: userDetail.userid,
              firebaseid: userDetail.firebase_id,
              companyid: userDetail.company_id,
              companyname: userDetail.company_name,
              displayname: userDetail.display_name,
              roleid: "AXD_RL_02",
              rolename: "Promoters",
              //licenceid: licence.licenceid,
              licenceid: "",
              //licencename: licence.licencename,
              licencename: "",
              //companylicenceid: licence.companylicenceid,
              companylicenceid: "",
              status: "approve",
              inviteid: null,
            };

            let member = await memberRepository.create(data);
            let res = await memberRepository.save(member);
            if (res) {
              let updateLicence = await licenceRepository.update(
                //{ companylicenceid: licence.companylicenceid },
                { companylicenceid: "" },
                { used: true }
              );
            }
            //}
          }

          await projectTokenRepository.update(
            { companytokenid: args.companytokenid },
            { used: true }
          );
          resolve(result);
        }
      }).catch((error) => {
        throw new Error(error.ErrorName);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * Edit project
 */
export const editProject = {
  type: ProjectType,
  args: {
    projectid: {
      type: new GraphQLNonNull(GraphQLString),
    },
    name: {
      type: new GraphQLNonNull(GraphQLString),
    },
    purpose: {
      type: new GraphQLNonNull(GraphQLString),
    },
    address: {
      type: new GraphQLNonNull(GraphQLString),
    },
    latitude: {
      type: new GraphQLNonNull(GraphQLString),
    },
    longitude: {
      type: new GraphQLNonNull(GraphQLString),
    },
    company: {
      type: new GraphQLNonNull(GraphQLString),
    },
    startDate: {
      type: new GraphQLNonNull(GraphQLString),
    },
    endDate: {
      type: new GraphQLNonNull(GraphQLString),
    },
    projectmembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
    teammembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
    projectOwner: {
      type: new GraphQLNonNull(GraphQLString),
    },
    outsidemembers: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        const log_userid = context.request.body.authdata.userid;
        
        const connection = await conn.on(args.company);
        let projectRepository = await connection.getRepository(Project);
        let licenceRepository = connection.getRepository(Licence);
        let projectMemberRepository = await connection.getRepository(
          ProjectMember
        );
        let campaignMasterRepository = await connection.getRepository(
          CampaignMaster
        );
        let memberRepository = await connection.getRepository(Member);
        let NotificationSettingsRepo = await connection.getRepository(
          NotificationSettings
        );
        let EmailSettingsRepo = await connection.getRepository(EmailSettings);

        const masterConnection = await conn.on(process.env.DB_DEFAULT);

        let notificationRepository = await masterConnection.getRepository(
          NotificationMaster
        );
        let NotificationTemplateRepo = await masterConnection.getRepository(
          NotificationTemplate
        );
        const EmailTemplateRepo = await masterConnection.getRepository(
          EmailTemplate
        );

        let Pro_dtl = await projectRepository.findOne({
          projectstatus: "active",
          name: args.name,
          projectid: { $ne: args.projectid },
        });
        if (Pro_dtl) {
          return reject({ ErrorName: errorName.DUPLICATE_PROJECT_ERROR });
        }

        let firebaseObject = [];
        let updateData = {
          name: args.name,
          purpose: args.purpose,
          address: args.address,
          latitude: args.latitude,
          longitude: args.longitude,
          company: args.company,
          startDate: args.startDate,
          endDate: args.endDate,
          status: 0,
          projectOwner: args.projectOwner,
        };
        let projectMembers = JSON.parse(decode(args.projectmembers));
        let inviteMembers = JSON.parse(decode(args.teammembers));
        let outsideMembers = JSON.parse(decode(args.outsidemembers));
        let members = [];
        let firebaseIds = [];
        let project = await projectRepository.findOne({
          projectid: args.projectid,
        });
        project = await Object.assign(project, updateData);
        let update = await projectRepository.save(project);

        let message = msgDetail.UPDATE_PROJECT.replace(
          "{{project_name}}",
          args.name
        );
        let logsData = {
          userid: log_userid,
          email: "",
          companyname: args.company,
          action: msgName.UPDATE_PROJECT,
          detail: message,
          dbName: args.company,
        };
        systemLog(logsData);

        if (!update) {
          return reject(new Error(errorName.UPDATEPROJECT_ERROR));
        } else {
          if (outsideMembers.length > 0) {
            
            const masterConnection = await conn.on(process.env.DB_DEFAULT);
            for (let val of outsideMembers) {
              const userRepo = await masterConnection.getRepository(User);
              let checkUser = await userRepo.find({ email: val.email });

              if (checkUser.length === 0) {
                let data = {
                  email: val.email,
                  projectid: project.projectid,
                  projectname: project.name,
                  projectowner: project.projectOwner,
                  inviteid: val.inviteid,
                  roleid: val.roleid,
                  rolename: val.rolename,
                  senderid: val.sendercompanyname,
                  receiverid: null,
                  displayname: val.senderdisplayname,
                  companyname: null,
                  status: "request",
                };
                const projectReqRepo = await masterConnection.getRepository(
                  ProjectRequest
                );
                const outsideUser = await projectReqRepo.create(data);
                const user = await projectReqRepo.save(outsideUser);
                if (user) {
                  let projectmemberdata = {
                    projectid: project.projectid,
                    roleid: val.roleid,
                    rolename: val.rolename,
                    status: "request",
                    inviteid: val.inviteid,
                  };
                  let savedata = await projectMemberRepository.create(
                    projectmemberdata
                  );
                  let saveProMember = await projectMemberRepository.save(
                    savedata
                  );
                  if (saveProMember) {
                    const mailOptions = {
                      from: process.env.ADMIN_EMAIL,
                      to: val.email,
                      subject: "Welcome to Aexdo.",
                      html:
                        "<p>" + process.env.FE_URL + "/register?email=" +
                        val.email +
                        "</p>",
                    };
                    Transporter.sendMail(mailOptions, async (error, info) => {
                      if (error) {
                        console.log(error);
                      } else {
                        console.log("Email sent: " + info.response);
                      }
                    });
                  }
                }
              }
            }
          }
          if (projectMembers.length > 0) {
            //asyncLoop( projectMembers, async (val, next) => {
            for (let pr = 0; pr < projectMembers.length; pr++) {
              let val = projectMembers[pr];
              let checkExist = await projectMemberRepository.find({
                projectid: args.projectid,
                userid: val.userid,
              });
              let companylicenceid = "";
              if (val.delete === true) {
                let findMember = await projectMemberRepository.findOne({
                  userid: val.userid,
                  projectid: val.projectid,
                });
                let deleteMember = await projectMemberRepository.delete({
                  userid: val.userid,
                  projectid: val.projectid,
                });
                let campaignList = await campaignMasterRepository.find({
                  projectid: args.projectid,
                  status: "active",
                });
                for (let m = 0; m < campaignList.length; m++) {
                  let campaignMemList = campaignList[m].member;
                  let newMemberListArr = [];
                  for (let n = 0; n < campaignMemList.length; n++) {
                    if (
                      campaignMemList[n].userid != val.userid ||
                      campaignMemList[n].type != "project"
                    ) {
                      newMemberListArr.push(campaignMemList[n]);
                    }
                  }
                  await campaignMasterRepository.update(
                    { campaignid: campaignList[m].campaignid },
                    { member: newMemberListArr }
                  );
                }

                if (deleteMember) {
                  let inAnotherProject = await projectMemberRepository.find({
                    userid: val.userid,
                  });

                  if (!inAnotherProject) {
                    inAnotherProject = await campaignMasterRepository.find({
                      member: { $elemMatch: { userid: val.userid } },
                      status: "active",
                    });
                  }

                  //send Notification
                  let noti_data = await NotificationTemplateRepo.findOne({
                    key: "REMOVE_IN_PROJECT",
                  });
                  let noti_set = await NotificationSettingsRepo.findOne({
                    userid: val.userid,
                    key: "REMOVE_IN_PROJECT",
                  });
                  if (!noti_set || !noti_set.isdisable) {
                    let addMessage = notificationMessage.REMOVE_IN_PROJECT;
                    if (noti_data) {
                      addMessage = noti_data.description;
                    }
                    let message = addMessage.replace(
                      "{{project_name}}",
                      args.name
                    );
                    let notificationMess = {
                      key: "REMOVE_IN_PROJECT",
                      senderid: log_userid,
                      projectid: project.projectid,
                      companyid: val.companyId,
                      companyname: val.companyname,
                      displayname: val.displayname,
                      message: message,
                      read: false,
                    };

                    let notiData = await notificationRepository.create({
                      userid: val.userid,
                      notifications: notificationMess,
                    });
                    await notificationRepository.save(notiData);
                  }

                  let email_set = await EmailSettingsRepo.findOne({
                    userid: val.userid,
                    key: "member_remove_in_project",
                  });
                  if (!email_set || !email_set.isdisable) {
                    let member = await memberRepository.findOne({
                      userid: val.userid,
                    });
                    let email_data = await EmailTemplateRepo.findOne({
                      key: "member_remove_in_project",
                    });
                    if (email_data) {
                      let mailOptions = {
                        from: process.env.ADMIN_EMAIL,
                        to: member.email,
                        subject: email_data.subject,
                        html: email_data.description,
                      };

                      Transporter.sendMail(
                        mailOptions,
                        async (error, info) => {
                          if (error) {
                            console.log(error);
                          } else {
                            console.log("Email sent: " + info.response);
                          }
                        }
                      );
                    }
                  }

                  const masterconnection = await conn.on(process.env.DB_DEFAULT);

                  let companyRequestRepository = await masterconnection.getRepository(
                    CompanyRequest
                  );

                  let companyDetail = await companyRequestRepository.findOne({
                    company_name: val.companyname,
                  });

                  if (args.company !== companyDetail.company_name) {
                    
                    const otherconnection = await conn.on(companyDetail.company_name);
                    let otherLicenceRepository = await otherconnection.getRepository(
                      Licence
                    );
                    let inviteRepository = await otherconnection.getRepository(
                      Invite
                    );
                    await inviteRepository.delete({
                      inviteid: findMember.inviteid,
                    });
                    if (findMember.companylicenceid != "") {
                      await otherLicenceRepository.update(
                        { companylicenceid: findMember.companylicenceid },
                        { used: false }
                      );
                    }
                  }

                  if (parseInt(inAnotherProject.length) == 0) {
                    let member = await memberRepository.findOne({
                      userid: findMember.userid,
                    });
                    await projectMemberRepository.delete({
                      userid: findMember.userid,
                    });
                    let userRepository = await masterconnection.getRepository(
                      User
                    );
                    let userMasDetail = await userRepository.findOne({
                      userid: val.userid,
                    });

                    if (userMasDetail != null) {
                      let newCmpName = userMasDetail.company_name.filter(
                        (val) => {
                          if (member.other_company) {
                            return val !== member.company_name;
                          } else {
                            return val;
                          }
                        }
                      );
                      let newDisplayName = userMasDetail.display_name.filter(
                        (val) => {
                          if (member.other_company) {
                            return val !== member.display_name;
                          } else {
                            return val;
                          }
                        }
                      );
                      userMasDetail.company_name = newCmpName;
                      userMasDetail.display_name = newDisplayName;
                      await userRepository.save(userMasDetail);
                    }
                  }

                  if (val.companylicenceid != "") {
                    let updateLicence = await licenceRepository.update(
                      { companylicenceid: val.companylicenceid },
                      { used: false }
                    );
                  }
                }
              } else {
                if (checkExist.length === 0) {
                  let licence;
                  if (val.licenceid != "") {
                    licence = await licenceRepository.findOne({
                      licenceid: val.licenceid,
                      used: false,
                    });
                    if (!licence) {
                      return reject({
                        ErrorName: errorName.LICENCELIST_ERROR,
                      });
                    }
                    companylicenceid = licence.companylicenceid;
                  }

                  let data = {
                    projectid: project.projectid,
                    name: val.name,
                    userid: val.userid,
                    firebaseid: val.firbaseid,
                    companyid: val.companyid,
                    companyname: val.companyname,
                    displayname: val.displayname,
                    roleid: val.roleid,
                    rolename: val.rolename,
                    licenceid: val.licenceid,
                    licencename: val.licencename,
                    companylicenceid: companylicenceid,
                    status: "approve",
                    inviteid: null,
                  };

                  let member = await projectMemberRepository.create(data);
                  let res = await projectMemberRepository.save(member);

                  //send Notification
                  let noti_data = await NotificationTemplateRepo.findOne({
                    key: "ADD_IN_PROJECT",
                  });
                  let noti_set = await NotificationSettingsRepo.findOne({
                    userid: val.userid,
                    key: "ADD_IN_PROJECT",
                  });
                  if (!noti_set || !noti_set.isdisable) {
                    let addMessage = notificationMessage.ADD_IN_PROJECT;
                    if (noti_data) {
                      addMessage = noti_data.description;
                    }
                    let message = addMessage.replace(
                      "{{project_name}}",
                      args.name
                    );
                    let notificationMess = {
                      key: "ADD_IN_PROJECT",
                      senderid: log_userid,
                      projectid: project.projectid,
                      companyid: val.companyid,
                      companyname: val.companyname,
                      displayname: val.displayname,
                      message: message,
                      read: false,
                    };

                    let notiData = await notificationRepository.create({
                      userid: val.userid,
                      notifications: notificationMess,
                    });
                    await notificationRepository.save(notiData);
                  }

                  let email_set = await EmailSettingsRepo.findOne({
                    userid: val.userId,
                    key: "user_added_to_project",
                  });
                  if (!email_set || !email_set.isdisable) {
                    let email_data = await EmailTemplateRepo.findOne({
                      key: "user_added_to_project",
                    });
                    if (email_data) {
                      let member = await memberRepository.findOne({
                        userid: val.userid,
                      });
                      if (member.email) {
                        let mailOptions = {
                          from: process.env.ADMIN_EMAIL,
                          to: member.email,
                          subject: email_data.subject,
                          html: email_data.description,
                        };

                        Transporter.sendMail(
                          mailOptions,
                          async (error, info) => {
                            if (error) {
                              console.log(error);
                            } else {
                              console.log("Email sent: " + info.response);
                            }
                          }
                        );
                      }
                    }
                  }

                  if (res) {
                    if (companylicenceid != "") {
                      let updateLicence = await licenceRepository.update(
                        { companylicenceid: companylicenceid },
                        { used: true }
                      );
                      if (updateLicence) {
                        //next();
                      }
                    }
                    //Send Email To Project members
                    let ProuserDtl = await memberRepository.findOne({
                      userid: val.userid,
                    });
                    if (ProuserDtl.email) {
                      const mailOptions = {
                        from: process.env.ADMIN_EMAIL,
                        to: ProuserDtl.email,
                        subject: "Project Assign",
                        html:
                          "<p>Hello,</p><br/><p>You have been assigned in :" +
                          args.name +
                          "</p>",
                      };
                      Transporter.sendMail(
                        mailOptions,
                        async (error, info) => {
                          if (error) {
                            console.log(error);
                          } else {
                            console.log("Email sent: " + info.response);
                          }
                        }
                      );
                    }
                    //next();
                  }
                } else {
                  let memberDetail = checkExist[0];
                  await projectMemberRepository.update(
                    { projectid: args.projectid, userid: val.userid },
                    { roleid: val.roleid, rolename: val.rolename }
                  );
                  if (memberDetail.inviteid != null) {
                    
                    const cmpConnection = await conn.on(memberDetail.companyname);
                    let inviteRepository = await cmpConnection.getRepository(
                      Invite
                    );
                    await inviteRepository.update(
                      { inviteid: memberDetail.inviteid },
                      { roleid: val.roleid, rolename: val.rolename }
                    );
                  }
                }
              }
            }
          }

          projectMembers.map((val, index) => {
            if (val.delete === false) {
              firebaseObject[val.firbaseid] = 0;
            }
          });

          if (firebaseObject.length > 0) {
            await db
              .ref("projects/" + project.projectid + "/unreadcount")
              .set(firebaseObject);
          }

          if (inviteMembers.length > 0) {
            for (let value of inviteMembers) {
              if (value.delete === true) {
                if (
                  value.companylicenceid &&
                  value.companylicenceid !== null
                ) {
                  await members.push(value);
                  
                  const otherConnection = await conn.on(value.companyname);
                  const licenceRepository = await otherConnection.getRepository(
                    Licence
                  );
                  const inviteRepository = await otherConnection.getRepository(
                    Invite
                  );
                  await inviteRepository.delete({ inviteid: value.inviteid });
                  const licence = await licenceRepository.findOne({
                    companylicenceid: value.companylicenceid,
                  });
                  await Object.assign(licence, { used: false });
                  const saveLicence = await licenceRepository.save(licence);
                  if (saveLicence) {
                    let deleteInvite = await projectMemberRepository.delete({
                      inviteid: value.inviteid,
                    });
                  }
                } else {
                  const otherConnection = await getConnection(
                    process.env.DB_PREFIX + value.companyname
                  );
                  const inviteRepository = await otherConnection.getRepository(
                    Invite
                  );
                  await inviteRepository.delete({ inviteid: value.inviteid });
                  let deleteInvite = await projectMemberRepository.delete({
                    inviteid: value.inviteid,
                  });
                }
              } else {
                let checkExist = await projectMemberRepository.find({
                  projectid: project.projectid,
                  inviteid: value.inviteid,
                });

                if (checkExist.length === 0) {
                  let saveInvite = await projectMemberRepository.save(value);
                } else {
                  await projectMemberRepository.update(
                    { inviteid: checkExist[0].inviteid },
                    { roleid: value.roleid, rolename: value.rolename }
                  );

                  const cmpConnection = await conn.on(checkExist[0].companyname);
                  let inviteRepository = await cmpConnection.getRepository(
                    Invite
                  );
                  await inviteRepository.update(
                    { inviteid: checkExist[0].inviteid },
                    { roleid: value.roleid, rolename: value.rolename }
                  );
                }
                const otherConnection = await conn.on(value.companyname);
                const inviteMemRepository = await otherConnection.getRepository(
                  Invite
                );
                const memberMemRepository = await otherConnection.getRepository(
                  Member
                );

                let cmpNotificationSettingsRepo = await connection.getRepository(
                  NotificationSettings
                );
                let cmpEmailSettingsRepo = await connection.getRepository(
                  EmailSettings
                );

                let inviteMemberDetail = await memberMemRepository.findOne({
                  company_name: value.companyname,
                  system_flag: true,
                });

                let data = {
                  projectid: value.projectid,
                  projectname: args.name,
                  projectowner: args.projectOwner,
                  inviteid: value.inviteid,
                  senderid: context.request.body.authdata.companyname,
                  receiverid: value.companyname,
                  displayname: value.senderdisplayname,
                  companyname: value.companyname,
                  roleid: value.roleid,
                  rolename: value.rolename,
                  status: value.status,
                };
                let invitedata = await inviteMemRepository.create(data);
                let savedata = await inviteMemRepository.save(invitedata);

                if (inviteMemberDetail) {
                  //send Notification
                  let noti_data = await NotificationTemplateRepo.findOne({
                    key: "PROJECT_MEMBER_REQ",
                  });
                  let noti_set = await cmpNotificationSettingsRepo.findOne({
                    userid: inviteMemberDetail.userid,
                    key: "PROJECT_MEMBER_REQ",
                  });
                  if (!noti_set || !noti_set.isdisable) {
                    let addMessage = notificationMessage.PROJECT_MEMBER_REQ;
                    if (noti_data) {
                      addMessage = noti_data.description;
                    }
                    let message = addMessage.replace(
                      "{{company_name}}",
                      value.senderdisplayname
                    );
                    let notificationMess = {
                      key: "PROJECT_MEMBER_REQ",
                      senderid: log_userid,
                      projectid: value.projectid,
                      companyid: inviteMemberDetail.company_id,
                      companyname: inviteMemberDetail.company_name,
                      displayname: inviteMemberDetail.display_name,
                      message: message,
                      read: false,
                    };

                    let notiData = await notificationRepository.create({
                      userid: inviteMemberDetail.userid,
                      notifications: notificationMess,
                    });
                    await notificationRepository.save(notiData);
                  }

                  let email_set = await cmpEmailSettingsRepo.findOne({
                    userid: inviteMemberDetail.userid,
                    key: "project_request",
                  });
                  if (!email_set || !email_set.isdisable) {
                    let email_data = await EmailTemplateRepo.findOne({
                      key: "project_request",
                    });
                    if (email_data) {
                      let mailOptions = {
                        from: process.env.ADMIN_EMAIL,
                        to: inviteMemberDetail.email,
                        subject: email_data.subject,
                        html: email_data.description,
                      };

                      Transporter.sendMail(
                        mailOptions,
                        async (error, info) => {
                          if (error) {
                            console.log(error);
                          } else {
                            console.log("Email sent: " + info.response);
                          }
                        }
                      );
                    }
                  }
                }

              }
            }
          }

          resolve(project);
        }
      }).catch((error) => {
        throw new Error(error.ErrorName);
      });
    } catch (e) {
      throw new Error(e.ErrorName);
    }
  },
};

/**
 * Get project list
 */
export const getProjectList = {
  type: GraphQLList(ProjectType),
  args: {
    company: {
      type: new GraphQLNonNull(GraphQLString),
    },
    isadmin: {
      type: GraphQLBoolean,
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        let log_userid = context.request.body.authdata.userid;
        
        const connection = await conn.on(args.company);
        const projectRepository = await connection.getRepository(Project);
        const MemberRepo = await connection.getRepository(Member);
        const projectMemberRepository = await connection.getRepository(ProjectMember);
        let ADMemberRepoData = await MemberRepo.findOne({ system_flag: true });
        let opts = [];

        if (args.isadmin) {
          opts = [{
            $addFields: {
              "displayname": ADMemberRepoData.display_name
            }
          },
          { $match: { projectstatus: "active" } },
          {
            $lookup: {
              from: "project_member",
              localField: "projectid",
              foreignField: "projectid",
              as: "project_member",
            },
          },
          {
            $lookup: {
              from: "invite_member",
              localField: "projectid",
              foreignField: "projectid",
              as: "invite_member",
            },
          },
          { $sort: { created_at: 1 } },
          ];
        } else {
          let mem_projects = await projectMemberRepository.find({
            userid: log_userid,
            status: "approve",
          });
          let project_ids = [];
          for (let fil_mem_projects of mem_projects) {
            project_ids.push(fil_mem_projects.projectid);
          }
          opts = [{
            $addFields: {
              "displayname": ADMemberRepoData.display_name
            }
          },
          { $match: { projectstatus: "active", projectid: { $in: project_ids } } },
          {
            $lookup: {
              from: "project_member",
              localField: "projectid",
              foreignField: "projectid",
              as: "project_member",
            },
          },
          {
            $lookup: {
              from: "invite_member",
              localField: "projectid",
              foreignField: "projectid",
              as: "invite_member",
            },
          },
          { $sort: { created_at: 1 } },
          ];
        }
        let projectRepositorydata = await projectRepository.aggregate(opts);
        let projects_list = await projectRepositorydata.toArray();
        resolve(projects_list);
      }).catch((error) => {
        throw new Error(error.ErrorName);
      });
    } catch (e) {
      throw new Error(e.ErrorName);
    }
  },
};

/**
 * Delete project
 */
export const deleteProject = {
  type: GraphQLList(ProjectType),
  args: {
    projectid: {
      type: GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        let log_userid = context.request.body.authdata.userid;
        
        const connection = await conn.on(context.request.body.authdata.companyname);
        const projectRepository = await connection.getRepository(Project);
        let campaignMasterRepository = await connection.getRepository(
          CampaignMaster
        );
        let projectTokenRepository = await connection.getRepository(
          ProjectToken
        );
        const ProbingMasterRepo = await connection.getRepository(ProbingMaster);
        const ProbingTodoLogRepo = await connection.getRepository(
          ProbingTodoLog
        );

        let project = await projectRepository.findOne({
          projectid: args.projectid,
        });
        if (!project) {
          return reject(new Error("Project not found."));
        }

        let campaignList = await campaignMasterRepository.find({
          projectid: args.projectid,
          status: "active",
        });
        
        let deleteProject = await projectRepository.update(
          { projectid: args.projectid },
          { projectstatus: "delete" }
        );
        if (!deleteProject) {
          return reject(new Error(errorName.PROJECTNOTFOUND_ERROR));
        }

        let memberRepository = await connection.getRepository(ProjectMember);
        let members = await memberRepository.find({
          projectid: project.projectid,
        });

        await memberRepository.update(
          { projectid: args.projectid, status: "approve" },
          { status: "delete" }
        );

        const masterconnection = await conn.on(process.env.DB_DEFAULT);
        let masMemberRepository = await connection.getRepository(Member);
        members.map(async (val, index) => {
          if (val.inviteid) {
            if (val.companylicenceid) {
              let deleteMember = await memberRepository.update(
                { userid: val.userid, projectid: args.projectid },
                { status: "delete" }
              );
              let inAnotherProject = await memberRepository.find({
                userid: val.userid,
                status: "approve",
              });

              if (parseInt(inAnotherProject.length) == 0) {
                let userRepository = masterconnection.getRepository(User);
                let userMasDetail = await userRepository.findOne({
                  userid: val.userid,
                });

                let member = await masMemberRepository.findOne({
                  userid: val.userid,
                });

                if (userMasDetail != null) {
                  let newCmpName = userMasDetail.company_name.filter((val) => {
                    return val !== member.company_name;
                  });
                  let newDisplayName = userMasDetail.display_name.filter(
                    (val) => {
                      return val !== member.display_name;
                    }
                  );
                  userMasDetail.company_name = newCmpName;
                  userMasDetail.display_name = newDisplayName;
                  await userRepository.save(userMasDetail);
                }
              }

              const licenceConnection = await conn.on(val.companyname);

              const licenceRepository = await licenceConnection.getRepository(
                Licence
              );
              const licence = await licenceRepository.findOne({
                companylicenceid: val.companylicenceid,
              });

              let licenceData = await Object.assign(licence, { used: false });
              const saveLicence = await licenceRepository.save(licenceData);

              const inviteRepository = await licenceConnection.getRepository(
                Invite
              );
              await inviteRepository.update(
                { projectid: args.projectid, status: "approve" },
                { status: "reject" }
              );
            }
          } else {
            if (val.companylicenceid) {
              const licenceRepository = await connection.getRepository(Licence);
              const licence = await licenceRepository.findOne({
                companylicenceid: val.companylicenceid,
              });
              let licenceData = await Object.assign(licence, { used: false });
              const saveLicence = await licenceRepository.save(licenceData);
            }
          }
        });

        //Delete campaigns
        if (campaignList.length > 0) {
          for (let fil_camp of campaignList) {
            let campaignDetail = await campaignMasterRepository.findOne({
              campaignid: fil_camp.campaignid,
            });

            let invitedMemberList = filter(
              { type: "invited" },
              campaignDetail.member
            );
            let memberList = filter({ type: "member" }, campaignDetail.member);

            for (let i = 0; i < invitedMemberList.length; i++) {
              let inviteMemberDetail = invitedMemberList[i];
              
              const cmpConnection = await conn.on(inviteMemberDetail.receiverid);

              if (inviteMemberDetail.companylicenceid) {
                const licenceRepository = await cmpConnection.getRepository(
                  Licence
                );
                await licenceRepository.update(
                  { companylicenceid: inviteMemberDetail.companylicenceid },
                  { used: false }
                );
              }

              if (inviteMemberDetail.inviteid) {
                const campaignInviteRepository = await cmpConnection.getRepository(
                  CampaignInvite
                );
                await campaignInviteRepository.update(
                  { inviteid: inviteMemberDetail.inviteid },
                  { status: "delete" }
                );
              }
            }

            for (let i = 0; i < memberList.length; i++) {
              let memberDetail = memberList[i];
              if (memberDetail.licenceId) {
                const licenceRepository = await connection.getRepository(Licence);
                await licenceRepository.update(
                  { companylicenceid: memberDetail.companylicenceid },
                  { used: false }
                );
              }
            }

            await campaignMasterRepository.update(
              { campaignid: fil_camp.campaignid },
              { status: "delete" }
            );
            
            await ProbingMasterRepo.updateMany(
              { campaignid: fil_camp.campaignid },
              { $set: { status: "hidden" } }
            );
            await ProbingTodoLogRepo.deleteMany({
              campaignid: fil_camp.campaignid,
            });
          }
        }

        let message = msgDetail.DELETE_PROJECT.replace(
          "{{project_name}}",
          project.name
        );
        let logsData = {
          userid: log_userid,
          email: "",
          companyname: project.company,
          action: msgName.DELETE_PROJECT,
          detail: message,
          dbName: project.company,
        };
        systemLog(logsData);

        let projectList = await projectRepository.find({
          projectstatus: "active",
        });

        resolve(projectList);
      }).catch((error) => {
        throw new Error(error.message);
      });
    } catch (e) {
      throw new Error(e.ErrorName);
    }
  },
};

/**
 * Invite project member list
 */
export const inviteMemberList = {
  type: GraphQLList(InviteType),
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        let company = context.request.body.authdata.companyname;
        
        const connection = await conn.on(company);
        const inviteRepository = await connection.getRepository(Invite);
        const invites = await inviteRepository.find({ status: "request" });
        if (!invites) {
          return reject(new Error(errorName.INVITELIST_ERROR));
        }
        resolve(invites);
      }).catch((error) => {
        console.log("error ", error);
        throw new Error(error);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * Accept project member request
 */
export const acceptInviteRequest = {
  type: GraphQLList(InviteType),
  args: {
    name: {
      type: GraphQLNonNull(GraphQLString),
    },
    company: {
      type: new GraphQLNonNull(GraphQLString),
    },
    licenceid: {
      type: new GraphQLNonNull(GraphQLString),
    },
    licencename: {
      type: new GraphQLNonNull(GraphQLString),
    },
    userid: {
      type: new GraphQLNonNull(GraphQLString),
    },
    inviteid: {
      type: new GraphQLNonNull(GraphQLString),
    },
    firebaseid: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        const log_userid = context.request.body.authdata.userid;
        let company = args.company;
        const connection = await conn.on(company);
        const licenceRepository = await connection.getRepository(Licence);
        let licence = [];
        if (args.licenceid != "") {
          licence = await licenceRepository.find({
            licenceid: args.licenceid,
            used: false,
          });
          if (licence.length === 0) {
            return reject({ ErrorName: errorName.LICENCEUSED_ERROR });
          }
        }
        const NotificationSettingsRepo = await connection.getRepository(
          NotificationSettings
        );
        let EmailSettingsRepo = await connection.getRepository(EmailSettings);
        const inviteRepository = await connection.getRepository(Invite);
        const invite = await inviteRepository.findOne({
          inviteid: args.inviteid,
        });
        if (!invite) {
          return reject({ ErrorName: errorName.INVITE_ERROR });
        }
        
        const memberConnection = await conn.on(invite.senderid);
        let projectmemberRepository = await memberConnection.getRepository(
          ProjectMember
        );

        let memNotificationSettingsRepo = await memberConnection.getRepository(
          NotificationSettings
        );
        let memEmailSettingsRepo = await memberConnection.getRepository(
          EmailSettings
        );

        let senderMemberRepository = await memberConnection.getRepository(
          Member
        );
        let senderMemberDetail = await senderMemberRepository.findOne({
          company_name: invite.senderid,
          system_flag: true,
        });

        const masterConnection = await conn.on(process.env.DB_DEFAULT);
        let notificationRepository = await masterConnection.getRepository(
          NotificationMaster
        );
        let NotificationTemplateRepo = await masterConnection.getRepository(
          NotificationTemplate
        );
        const EmailTemplateRepo = await masterConnection.getRepository(
          EmailTemplate
        );

        let existsuser = await projectmemberRepository.find({
          projectid: invite.projectid,
          userid: args.userid,
        });
        if (existsuser.length > 0) {
          return reject({ ErrorName: errorName.USER_ALREADY_EXISTS });
        }

        let firebaseObject = [];
        let memberRepo = await connection.getRepository(Member);
        let userdetails = await memberRepo.findOne({ userid: args.userid });

        if (!userdetails) {
          return reject(new Error(errorName.INVITEUPDATE_ERROR));
        }

        const memberRepository = await memberConnection.getRepository(Member);
        let memberdatas = await memberRepository.find({
          userid: userdetails.userid,
        });
        if (memberdatas.length === 0) {
          let memberdata = await memberRepository.findOne({
            system_flag: true,
          });
          let userdata = {
            system_flag: false,
            plan: null,
            last_login: null,
            userid: userdetails.userid,
            name: userdetails.name,
            email: userdetails.email,
            company_id: memberdata.company_id,
            company_name: memberdata.company_name,
            display_name: memberdata.display_name,
            company_address: memberdata.company_address,
            registration_country: memberdata.registration_country,
            contact_number: userdetails.contact_number,
            status: memberdata.status,
            approve_reject_by: memberdata.approve_reject_by,
            company_strength: memberdata.company_strength,
            role_id: null,
            role_name: null,
            firebase_id: userdetails.firebase_id,
            other_company: true,
          };
          let savedata = await memberRepository.create(userdata);
          await memberRepository.save(savedata);
        }

        const member = await projectmemberRepository.findOne({
          inviteid: args.inviteid,
        });
        if (member) {
          let companylicenceid = "";
          if (args.licenceid != "") {
            companylicenceid = licence[0].companylicenceid;
          }

          let invitedata = {
            userid: userdetails.userid,
            licenceid: args.licenceid,
            licencename: args.licencename,
            companylicenceid: companylicenceid,
            status: "approve",
          };

          let update = await inviteRepository.update(
            { inviteid: args.inviteid },
            invitedata
          );

          if (!update) {
            return reject(new Error(errorName.INVITEUPDATE_ERROR));
          } else {
            let requests = Object.assign(member, {
              status: "approve",
              name: args.name,
              userid: args.userid,
              companyname: invite.receiverid,
              displayname: invite.companyname,
              senderdisplayname: invite.displayname,
              sendercompanyname: invite.senderid,
              firebaseid: args.firebaseid,
              licenceid: args.licenceid,
              licencename: args.licencename,
              companylicenceid: companylicenceid,
            });

            const save = await projectmemberRepository.save(requests);
            if (save) {
              //Send NOtification
              let noti_data = await NotificationTemplateRepo.findOne({
                key: "ADD_IN_PROJECT",
              });
              let noti_set = await NotificationSettingsRepo.findOne({
                userid: userdetails.userid,
                key: "ADD_IN_PROJECT",
              });
              if (!noti_set || !noti_set.isdisable) {
                let addMessage = notificationMessage.ADD_IN_PROJECT;
                if (noti_data) {
                  addMessage = noti_data.description;
                }
                let message = addMessage.replace(
                  "{{project_name}}",
                  invite.projectname
                );
                let notificationMess = {
                  key: "ADD_IN_PROJECT",
                  senderid: log_userid,
                  projectid: invite.projectid,
                  companyid: invite.companyId,
                  companyname: invite.senderid,
                  displayname: invite.displayname,
                  message: message,
                  read: false,
                };

                let notiData = await notificationRepository.create({
                  userid: userdetails.userid,
                  notifications: notificationMess,
                });
                await notificationRepository.save(notiData);
              }

              let email_set = await EmailSettingsRepo.findOne({
                userid: userdetails.userid,
                key: "user_added_to_project",
              });
              if (!email_set || !email_set.isdisable) {
                let email_data = await EmailTemplateRepo.findOne({
                  key: "user_added_to_project",
                });
                if (email_data) {
                  if (member.email) {
                    let mailOptions = {
                      from: process.env.ADMIN_EMAIL,
                      to: userdetails.email,
                      subject: email_data.subject,
                      html: email_data.description,
                    };

                    Transporter.sendMail(mailOptions, async (error, info) => {
                      if (error) {
                        console.log(error);
                      } else {
                        console.log("Email sent: " + info.response);
                      }
                    });
                  }
                }
              }

              //Send NOtification
              let memnoti_data = await NotificationTemplateRepo.findOne({
                key: "PROJECT_REQ_ACCEPT",
              });
              let memnoti_set = await memNotificationSettingsRepo.findOne({
                userid: senderMemberDetail.userid,
                key: "PROJECT_REQ_ACCEPT",
              });
              if (!memnoti_set || !memnoti_set.isdisable) {
                let senderAddMessage = notificationMessage.PROJECT_REQ_ACCEPT;
                if (memnoti_data) {
                  senderAddMessage = memnoti_data.description;
                }
                let memberMessage1 = senderAddMessage.replace(
                  "{{project_name}}",
                  invite.projectname
                );
                let memberMessage = memberMessage1.replace(
                  "{{company_name}}",
                  invite.companyname
                );
                let senderNotificationMess = {
                  key: "PROJECT_REQ_ACCEPT",
                  senderid: log_userid,
                  projectid: invite.projectid,
                  companyid: senderMemberDetail.company_id,
                  companyname: senderMemberDetail.company_name,
                  displayname: senderMemberDetail.display_name,
                  message: memberMessage,
                  read: false,
                };

                let memNotiData = await notificationRepository.create({
                  userid: senderMemberDetail.userid,
                  notifications: senderNotificationMess,
                });
                await notificationRepository.save(memNotiData);
              }

              let mememail_set = await memEmailSettingsRepo.findOne({
                userid: senderMemberDetail.userid,
                key: "project_req_accept",
              });
              if (!mememail_set || !mememail_set.isdisable) {
                let mememail_data = await EmailTemplateRepo.findOne({
                  key: "project_req_accept",
                });
                if (mememail_data) {
                  if (senderMemberDetail.email) {
                    let mailOptions = {
                      from: process.env.ADMIN_EMAIL,
                      to: senderMemberDetail.email,
                      subject: mememail_data.subject,
                      html: mememail_data.description,
                    };

                    Transporter.sendMail(mailOptions, async (error, info) => {
                      if (error) {
                        console.log(error);
                      } else {
                        console.log("Email sent: " + info.response);
                      }
                    });
                  }
                }
              }

              const masterConnection = await conn.on(process.env.DB_DEFAULT);
              let userRepo = await masterConnection.getRepository(User);
              let userdata = await userRepo.find({ userid: args.userid });

              if (userdata.length > 0) {
                let user = await userRepo.findOne({ userid: args.userid });

                let companyname = invite.senderid;
                if (user.company_name.indexOf(companyname) < 0) {
                  user.company_name.push(companyname);
                  user.display_name.push(invite.displayname);
                  await userRepo.save(user);
                }
              }
            }
          }

          await db
            .ref("projects/" + invite.projectid + "/unreadcount")
            .once("value", (snapshot) => {
              if (snapshot.val() === null) {
                firebaseObject[args.userid] = 0;
              } else {
                firebaseObject = snapshot.val();
                firebaseObject[args.userid] = 0;
              }
            });
          if (args.licenceid != "") {
            if (licence.length > 0) {
              let used = true;
              let licenceUpdate = Object.assign(licence[0], { used: used });
              const update = await licenceRepository.save(licenceUpdate);
              db.ref("projects/" + invite.projectid + "/unreadcount/").set(
                firebaseObject
              );
            }
          }

          let message = msgDetail.ACCEPT_INVITE_REQUEST.replace(
            "{{ACCEPT_INVITE_REQUEST}}",
            args.name
          );
          let logsData = {
            userid: log_userid,
            email: "",
            companyname: invite.companyname,
            action: msgName.ACCEPT_INVITE_REQUEST,
            detail: message,
            dbName: invite.companyname,
          };
          systemLog(logsData);

          let messagesec = msgDetail.ACCEPT_INVITE_REQUEST.replace(
            "{{ACCEPT_INVITE_REQUEST}}",
            senderMemberDetail.display_name
          );
          let logsDatasec = {
            userid: log_userid,
            email: "",
            companyname: invite.senderid,
            action: msgName.ACCEPT_INVITE_REQUEST,
            detail: messagesec,
            dbName: invite.senderid,
          };
          systemLog(logsDatasec);
        }

        let invites = await inviteRepository.find({ status: "request" });
        resolve(invites);
      }).catch((error) => {
        throw new Error(error.ErrorName);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * Decline project member request
 */
export const declineInviteRequest = {
  type: new GraphQLObjectType({
    name: "decline",
    fields: () => {
      return {
        message: {
          type: GraphQLString,
        },
        error: {
          type: GraphQLBoolean,
        },
        success: {
          type: GraphQLBoolean,
        },
      };
    },
  }),
  args: {
    inviteid: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        const log_userid = context.request.body.authdata.userid;
        let company = context.request.body.authdata.companyname;
        
        const connection = await conn.on(company);
        const NotificationSettingsRepo = await connection.getRepository(
          NotificationSettings
        );
        const EmailSettingsRepo = await connection.getRepository(EmailSettings);
        const inviteRepository = await connection.getRepository(Invite);
        const invite = await inviteRepository.findOne({
          inviteid: args.inviteid,
        });

        const masterConnection = await conn.on(process.env.DB_DEFAULT);
        let notificationRepository = await masterConnection.getRepository(
          NotificationMaster
        );
        let NotificationTemplateRepo = await masterConnection.getRepository(
          NotificationTemplate
        );
        let EmailTemplateRepo = await masterConnection.getRepository(
          EmailTemplate
        );

        if (!invite) {
          return reject(new Error(errorName.INVITE_ERROR));
        }
        let data = Object.assign(invite, { status: "reject" });
        let update = inviteRepository.save(data);

        if (!update) {
          return reject(new Error(errorName.INVITEUPDATE_ERROR));
        } else {
          
          const memberConnection = await conn.on(invite.senderid);
          const memberRepository = await memberConnection.getRepository(
            ProjectMember
          );
          const member = await memberRepository.findOne({
            inviteid: args.inviteid,
          });

          let senderMemberRepository = await memberConnection.getRepository(
            Member
          );
          let senderMemberDetail = await senderMemberRepository.findOne({
            company_name: invite.senderid,
            system_flag: true,
          });

          let requests = Object.assign(member, { status: "reject" });
          await memberRepository.save(requests);

          //Send Notification
          let noti_data = await NotificationTemplateRepo.findOne({
            key: "PROJECT_REQ_REJECT",
          });
          let noti_set = await NotificationSettingsRepo.findOne({
            userid: senderMemberDetail.userid,
            key: "PROJECT_REQ_REJECT",
          });
          if (!noti_set || !noti_set.isdisable) {
            let senderAddMessage = notificationMessage.PROJECT_REQ_REJECT;
            if (noti_data) {
              senderAddMessage = noti_data.description;
            }
            let memberMessage1 = senderAddMessage.replace(
              "{{project_name}}",
              invite.projectname
            );
            let memberMessage = memberMessage1.replace(
              "{{company_name}}",
              invite.companyname
            );
            let senderNotificationMess = {
              key: "PROJECT_REQ_REJECT",
              senderid: log_userid,
              projectid: invite.projectid,
              companyid: senderMemberDetail.company_id,
              companyname: senderMemberDetail.company_name,
              displayname: senderMemberDetail.display_name,
              message: memberMessage,
              read: false,
            };

            let memNotiData = await notificationRepository.create({
              userid: senderMemberDetail.userid,
              notifications: senderNotificationMess,
            });
            await notificationRepository.save(memNotiData);
          }

          let email_set = await EmailSettingsRepo.findOne({
            userid: senderMemberDetail.userid,
            key: "project_req_reject",
          });
          if (!email_set || !email_set.isdisable) {
            let email_data = await EmailTemplateRepo.findOne({
              key: "project_req_reject",
            });
            if (email_data) {
              let mailOptions = {
                from: process.env.ADMIN_EMAIL,
                to: senderMemberDetail.email,
                subject: email_data.subject,
                html: email_data.description,
              };

              Transporter.sendMail(mailOptions, async (error, info) => {
                if (error) {
                  console.log(error);
                } else {
                  console.log("Email sent: " + info.response);
                }
              });
            }
          }

          let message = msgDetail.DECLINE_MEMBER_INVITE.replace(
            "{{user_name}}",
            senderMemberDetail.display_name
          );
          let logsData = {
            userid: log_userid,
            email: "",
            companyname: company,
            action: msgName.DECLINE_MEMBER_INVITE,
            detail: message,
            dbName: company,
          };
          systemLog(logsData);
        }

        resolve({
          message: "Decline successfully.",
          error: false,
          success: true,
        });
      }).catch((error) => {
        throw new Error(error);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * get project detail
 */
export const projectDetail = {
  type: GraphQLList(ProjectType),
  args: {
    id: {
      type: GraphQLNonNull(GraphQLString),
    },
    company: {
      type: GraphQLString,
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        
        const Masterconnection = await conn.on(process.env.DB_DEFAULT);
        const ProjectRequestRepo = Masterconnection.getRepository(ProjectRequest);
        let company = args.company
          ? args.company
          : context.request.body.authdata.companyname;
        
        const connection = await conn.on(company);
        const projectRepository = connection.getRepository(Project);
        const MemberRepo = connection.getRepository(Member);
        const cursor = await projectRepository.aggregate([
          { $match: { projectid: args.id } },
          {
            $lookup: {
              from: "project_member",
              let: { projectid: "$projectid" },
              pipeline: [
                { $match: { inviteid: null } },
                { $match: { projectid: args.id } },
              ],
              as: "project_member",
            },
          },
          {
            $lookup: {
              from: "project_member",
              let: { projectid: "$projectid" },
              pipeline: [
                { $match: { inviteid: { $ne: null } } },
                { $match: { projectid: args.id } },
                { $match: { status: "request" } },
              ],
              as: "invite_member",
            },
          },
          {
            $lookup: {
              from: "project_member",
              let: { projectid: "$projectid" },
              pipeline: [
                { $match: { status: "approve" } },
                { $match: { projectid: args.id } },
              ],
              as: "active_member",
            },
          },
          {
            $lookup: {
              from: "project_member",
              let: { projectid: "$projectid" },
              pipeline: [
                { $match: { status: "deleted" } },
                { $match: { projectid: args.id } },
              ],
              as: "delete_member",
            },
          },
        ]);

        let projects = await cursor.toArray();

        if (!projects) {
          return reject(new Error(errorName.PROJECTDETAIL_ERROR));
        }
        //push User Email for new funcationality
        if (
          projects[0].project_member &&
          projects[0].project_member.length > 0
        ) {
          for (let i = 0; i < projects[0].project_member.length; i++) {
            let mem_data = await MemberRepo.findOne({
              userid: projects[0].project_member[i].userid,
            });
            if (projects[0].project_member[i]) {
              if (mem_data) {
                projects[0].project_member[i].email = mem_data.email; //push Email
              }
            }
          }
        }
        if (
          projects[0].active_member &&
          projects[0].active_member.length > 0
        ) {
          for (let i = 0; i < projects[0].active_member.length; i++) {
            let mem_data = await MemberRepo.findOne({
              userid: projects[0].active_member[i].userid,
            });
            if (projects[0].active_member[i]) {
              if (mem_data) {
                projects[0].active_member[i].email = mem_data.email; //push Email
              }
            }
          }
        }
        if (
          projects[0].invite_member &&
          projects[0].invite_member.length > 0
        ) {
          for (let i = 0; i < projects[0].invite_member.length; i++) {
            let mem_data = await ProjectRequestRepo.findOne({
              inviteid: projects[0].invite_member[i].inviteid,
            });
            if (projects[0].invite_member[i]) {
              if (mem_data) {
                projects[0].invite_member[i].email = mem_data.email; //push Email
              }
            }
          }
        }

        getAllAttechment(projects)
          .then((response) => {
            let withattachments = response;
            resolve(withattachments);
          })
          .catch((errror) => {
            reject(errror);
          });
      }).catch((error) => {
        throw new Error(error);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * Delete invite member
 */
export const deleteInviteMember = {
  type: new GraphQLObjectType({
    name: "delete",
    fields: () => {
      return {
        message: {
          type: GraphQLString,
        },
        error: {
          type: GraphQLBoolean,
        },
        success: {
          type: GraphQLBoolean,
        },
      };
    },
  }),
  args: {
    inviteid: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        let log_userid = context.request.body.authdata.userid;
        let company = context.request.body.authdata.companyname;
        
        const connection = await conn.on(company);
        const inviteRepository = await connection.getRepository(Invite);
        const invite = await inviteRepository.findOne({
          inviteid: args.inviteid,
        });

        if (!invite) {
          return reject(new Error(errorName.INVITE_ERROR));
        }
        let data = Object.assign(invite, { status: "remove" });
        let update = inviteRepository.save(data);

        if (!update) {
          return reject(new Error(errorName.INVITEUPDATE_ERROR));
        } else {
          
          const projectMemberConn = await conn.on(invite.senderid);
          const projectMemberRepo = await projectMemberConn.getRepository(
            ProjectMember
          );
          const projectMember = await projectMemberRepo.findOne({
            inviteid: args.inviteid,
          });
          let requests = Object.assign(projectMember, { status: "remove" });
          let saveProjectMember = await projectMemberRepo.save(requests);
          if (saveProjectMember) {
            const member = await projectMemberRepo.findOne({
              userid: projectMember.userid,
            });

            if (member.length === 1) {
              const memberRepo = await projectMemberConn.getRepository(Member);
              let deleteMember = await memberRepo.delete({
                userid: projectMember.userid,
              });

              let message = msgDetail.DELETE_INVITED_MEMBER.replace(
                "{{company_name}}",
                memberRepo.display_name
              );
              let logsData = {
                userid: log_userid,
                email: "",
                companyname: company,
                action: msgName.DELETE_INVITED_MEMBER,
                detail: message,
                dbName: company,
              };
              systemLog(logsData);
            }
          }
        }

        resolve({
          message: "Delete successfully.",
          error: false,
          success: true,
        });
      }).catch((error) => {
        console.log("error ", error);
        throw new Error(error);
      });
    } catch (e) {
      console.log("e ", e);
    }
  },
};

/**
 * Get user's project list
 */
export const getMemberDetail = {
  type: GraphQLList(MemberDetailType),
  args: {
    userid: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
  resolve: async (root, args, context, info) => {
    try {
      await verifyToken(context.request, context.res);
      return new Promise(async (resolve, reject) => {
        let company = context.request.body.authdata.companyname;
        
        const connection = await conn.on(company);

        let userId = args.userid;
        const projectMemberRepository = await connection.getRepository(
          ProjectMember
        );
        const memberProject = await projectMemberRepository.aggregate([
          { $match: { userid: userId, status: "approve" } },
          {
            $lookup: {
              from: "project",
              localField: "projectid",
              foreignField: "projectid",
              as: "project_detail",
            },
          },
          { $unwind: { path: "$project_detail" } },
          { $match: { "project_detail.projectstatus": "active" } },
        ]);

        let projects = await memberProject.toArray();

        const inviteMemberRepository = await connection.getRepository(Invite);
        const inviteMemProject = await inviteMemberRepository.find({
          userid: userId,
          status: "approve",
        });

        let allProject = projects.concat(inviteMemProject);

        const companyRepository = await connection.getRepository(Member);
        let allUserProjectData = new Array();
        Promise.all(
          allProject.map(async (val, index) => {
            let responseData = {
              userid: val.userid,
              roleid: val.roleid,
              rolename: val.rolename,
              licenceid: val.licenceid,
              licencename: val.licencename,
              companylicenceid: val.companylicenceid,
              projectid: val.projectid,
              displayname: "",
              company_name: "",
              projectname: "",
            };

            if (val.inviteid == null) {
              responseData.displayname = val.displayname;
              responseData.company_name = val.companyname;
            } else {
              responseData.displayname = val.displayname;
              responseData.company_name = val.senderid;
            }

            if (val.projectname) {
              responseData.projectname = val.projectname;
            } else {
              responseData.projectname = val.project_detail.name;
            }

            allUserProjectData.push(responseData);
          })
        ).finally(() => {
          resolve(allUserProjectData);
        });
      }).catch((error) => {
        throw new Error(error.ErrorName);
      });
    } catch (e) {
      throw new Error(e.ErrorName);
    }
  },
};