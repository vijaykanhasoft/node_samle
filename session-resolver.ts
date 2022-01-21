/*
* This is our main logic file
* Here code of save session, update session, list session/Experience
* This is graphql resolver, here grapql query and mutation
*/

import { Arg, Ctx, Mutation, Query, Resolver, Root, Subscription } from "type-graphql";
import { Brackets, In, IsNull, Not, ILike, Between, SimpleConsoleLogger, LessThanOrEqual, MoreThanOrEqual } from "typeorm"
import * as moment from 'moment'
import 'moment-timezone';
import * as AWS from 'aws-sdk';
import { config } from "../config";
import axios from 'axios'
import { v4 as uuid4 } from 'uuid';
import * as fs from "fs";
import * as newrelic from 'newrelic';
import { RRule, RRuleSet, rrulestr } from 'rrule';
const momentTz = require('moment-timezone');

//load entities
import {
	Customers,
	Customtype,
	SessionMarkers,
	SessionMetrics,
	SessionParticipants,
	Sessions,
	UserDevices,
	Users,
	UserMetrics,
	CustomerSessions,
	Tags,
	CommonResponse,
	CustomerCategories,
	CustomerThresholds,
	CustomerDepartments,
	RoleAccess,
	Sharetype,
	Projects,
	CustomerNeedToKnow,
	Roles,
	ParticipantsGroupList,
	ParticipantsGroup
} from '../entities';
//load helper
import {
	getTenant,
	stimulusDetails,
	schedule_session,
	search,
	s3_object_url,
	sendEmail,
	getDateFormatString,
	getTimeZone,
	createDynamicLinkBranchIO,
	addParticipantsTowerData,
	createBraintrustResults,
	createBraintrustSimulate,
	addLogToAws,
	secondsToDhms,
	capitalizeFirstLetter,
	updateTagsAllPlace
} from '../helper';
import GraphQLJSON from "graphql-type-json";
//load database
import { connection } from "../connection";
import { logger } from '../logger';
import {
	ParticipantStatus,
	Thumbnails,
	search as expeienceSearch,
	listExperience,
	Experieces,
	category,
	searchExperience,
	RegressionAttended,
	participantListExperience
} from './types/'
import { URL } from "url";
import { sqsSendMessage } from "../sqsHelper";
var timedifference = new Date().getTimezoneOffset();
var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3();
var sqsQueueURl = config.aws.sqsQueueUrl;
var scheduleSqsQueueUrl = config.aws.scheduleSqsQueueUrl;

var receiveMessageParams = {
	QueueUrl: sqsQueueURl,
	MaxNumberOfMessages: 1,
	VisibilityTimeout: 3600,
	WaitTimeSeconds: 2
};

@Resolver(Sessions)
export class SessionResolver {

	/**
	 * Create Experience
	 * @param user_id id of logged in user
	 * @param title name of experience
	 * @param description details about experience
	 * @param scheduledstart start date of scheduled experience
	 * @param scheduledend end date of scheduled experience
	 */
	@Mutation(returns => Customtype)
	async createExperience(
		@Ctx() { req },
		@Arg("user_id") user_id: string,
		@Arg("title") title: string,
		@Arg("description") description: string,
		@Arg("scheduled_start") scheduledstart: string,
		@Arg("scheduled_end", { nullable: true }) scheduledend: string,
		@Arg("status") status: string,
		@Arg("type") sessionType: string,
		@Arg("project_id", { nullable: true }) projectId: number,
		@Arg("agenda_json", type => GraphQLJSON, { nullable: true }) agendaJson: any,
		@Arg("category", { nullable: true }) sessionCategory: string,
		@Arg("subcategory", { nullable: true }) sessionSubCategory: string,
		@Arg("participants", type => [GraphQLJSON]) participants: [any],
		@Arg("session_code") sessionCode: string,
		@Arg("enable_controls", { nullable: true }) enable_controls: boolean,
		@Arg("enable_watermark", { nullable: true }) enable_watermark: boolean,
		@Arg("surveylink", { nullable: true }) surveylink: string,
		@Arg("braintrust_id", { nullable: true }) braintrust_id: string,
		@Arg("braintrust_demo", { nullable: true }) braintrust_demo: boolean
	): Promise<Customtype | undefined> {
		let returnResult;
		try {
			await addLogToAws({
				category: 'info',
				method: 'createExperience',
				message: `Request data`,
				data: { user_id: user_id, title: title, sessionCode: sessionCode, participants: participants, agendaJson: agendaJson, scheduledstart: scheduledstart, scheduledend: scheduledend, braintrust_id: braintrust_id, braintrust_demo: braintrust_demo }
			});
			console.log("participants ", participants);
			let currentDate = moment(moment().format('YYYY-MM-DD hh:mm a')).utc().toISOString()

			//remove seconds from schedule start and end
			scheduledstart = moment(moment(scheduledstart).format('YYYY-MM-DD hh:mm a')).utc().toISOString()
			scheduledend = moment(moment(scheduledend).format('YYYY-MM-DD hh:mm a')).utc().toISOString()

			let requestScheduledStart = scheduledstart;
			logger.info("currentDate--->", currentDate);
			logger.info("schedule start date --->", scheduledstart);
			logger.info("schedule end date --->", scheduledend);
			logger.info("session code --->", sessionCode);

			let newTimeWith1Minute = moment(moment(currentDate).add(1, 'minutes')).utc().toISOString();
			if (moment(currentDate).unix() > moment(scheduledstart).unix()) {
				logger.info("schedule start is past from current")
				scheduledstart = newTimeWith1Minute
			}

			let schemaname = !!req.body.schemaname ? req.body.schemaname : req.headers.schemaname
			const masterConnection = await connection("public");
			const customerRepo = masterConnection.getRepository(Customers);
			const customerSessionRepo = masterConnection.getRepository(CustomerSessions);
			const publicUserRepository = masterConnection.getRepository(Users);
			const tenantConnection = await connection(schemaname);
			const sessionRepository = tenantConnection.getRepository(Sessions);
			const userRepository = tenantConnection.getRepository(Users);
			const roleRepository = tenantConnection.getRepository(Roles);
			const sessionMarkerRepository = tenantConnection.getRepository(SessionMarkers);
			const userMetricsRepository = tenantConnection.getRepository(UserMetrics);
			const tenantParticipantsRepo = tenantConnection.getRepository(SessionParticipants);
			const participantGroupListRepo = tenantConnection.getRepository(ParticipantsGroupList);
			const participantsGroupRepository = tenantConnection.getRepository(ParticipantsGroup)
			const tagsRepository = tenantConnection.getRepository(Tags)
			const departmentRepository = masterConnection.getRepository(CustomerDepartments)
			const categoriesRepository = masterConnection.getRepository(CustomerCategories)

			let within5min = false
			let getSessionDetails = await sessionRepository.findOne({
				where: {
					session_code: sessionCode
				}
			})
			if (!!getSessionDetails) {
				throw new Error("Session code already exists");
			}
			let newTimeWith30Secs = moment(moment(scheduledstart).add(30, 'seconds')).utc().toISOString();

			let getFindCustomer = await userRepository.findOne({ user_id: +user_id })
			let getTenantData = await getTenant(sessionCode);
			logger.info("getTenantData ", getTenantData);
			await addLogToAws({
				category: 'info',
				method: 'createExperience',
				message: `Get tenant of session code ${sessionCode}`,
				data: { getTenantData: getTenantData }
			});
			
			//logs
			await addLogToAws({ 
				category:'info', 
				method:'createExperience', 
				message:`Create experience Request ${sessionCode} agendas`, data:agendaJson
			});
			await addLogToAws({ 
				category:'info', 
				method:'createExperience', 
				message:`Create experience Request ${sessionCode} scheduledstart`, data:scheduledstart
			});
			
			await addLogToAws({ 
				category:'info', 
				method:'createExperience', 
				message:`Create experience Request ${sessionCode} scheduledend`, data:scheduledend
			});
			
			let sessionObject: Partial<Sessions> = {
				"owner_user_id": +user_id,
				"session_title": title,
				"session_description": description,
				"session_type": sessionType,
				"session_category": sessionCategory.toUpperCase(),
				"session_code": sessionCode,
				"session_status": status,
				"scheduled_start_at": scheduledstart,
				"scheduled_end_at": (!!scheduledend ? moment(scheduledend).utc().toISOString() : null),
				"created_by": +user_id,
				"project_id": projectId,
				"agenda_json": JSON.stringify(agendaJson),
				"session_subcategory": sessionSubCategory.toUpperCase(),
				"customer_id": getFindCustomer.customer_id,
				"enable_watermark": enable_watermark,
				"enable_controls": enable_controls,
				"braintrust_id": braintrust_id ? braintrust_id : null,
				"bt_type": braintrust_id ? 'simulate' : null
			};
			logger.info("sessionObject ", sessionObject);
			await addLogToAws({ 
				category:'info', 
				method:'createExperience', 
				message:`Create Experience Details`, data:sessionObject
			});
			let sessionResult = await sessionRepository.save(sessionObject)
			logger.info("sessionResult---->", sessionResult)

			// create object for schedule triggers
			var triggersObj: any = {
				"tenant_id": getFindCustomer.customer_id,
				"session_code": sessionCode,
				"entry_time": moment().unix(),
				"triggers": []
			}
			let stimulus_video_length = 0
			//get stimulus details if async
			if (sessionType == "ASYNC") {
				let thumbnailObj = {
					small_thumbnail: "",
					large_thumbnail: "",
					stimulus_status: ""
				}

				let stimulusDetailsData = await stimulusDetails(getFindCustomer.customer_id, sessionCode, req.headers.idtoken);

				await addLogToAws({ category: 'info', method: 'createExperience', message: `Response for stimulus data for ${sessionCode}`, data: stimulusDetailsData }); //logs
				
				logger.info(`${sessionCode} stimulus details-->`, stimulusDetailsData)
				if (!!stimulusDetailsData[0]) {
					if (stimulusDetailsData[0].stimulus_video_length && parseInt(stimulusDetailsData[0].stimulus_video_length) > 0) {
						stimulus_video_length = parseInt(stimulusDetailsData[0].stimulus_video_length)
					}
					if (stimulusDetailsData[0].stimulus_type == 'AUDIO') {
						thumbnailObj.stimulus_status = stimulusDetailsData[0].stimulus_status == "READY" ? "READY" : "";
						let randonNumber = Math.floor(Math.random() * 71) + 1;
						var smallS3params = { Bucket: config.aws.s3Bucket, Key: `placeholders/small-${randonNumber}.svg` };
						let getSmallThumbnail: any = await s3_object_url(smallS3params)

						let paramsLarge = { Bucket: config.aws.s3Bucket, Key: `placeholders/large-${randonNumber}.svg` };
						let getLargeThumbnail: any = await s3_object_url(paramsLarge)

						thumbnailObj.large_thumbnail = getLargeThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
						thumbnailObj.small_thumbnail = getSmallThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
						logger.info(`${sessionCode} thumbnailObj.large_thumbnail--->`, thumbnailObj.large_thumbnail)
						logger.info(`${sessionCode} thumbnailObj.large_thumbnail--->`, thumbnailObj.large_thumbnail)
						//update thumbnail data
						// await sessionRepository.update({ session_id: sessionResult.session_id }, thumbnailObj)
					} else if (stimulusDetailsData[0].stimulus_status == "READY") {
						thumbnailObj.stimulus_status = "READY"
						if (stimulusDetailsData[0].thumbnails) {

							if (stimulusDetailsData[0].thumbnails.length > 0) {
								//get large thumbnail
								let largeThumbnail = stimulusDetailsData[0].thumbnails.find(x => Math.max.apply(Math, stimulusDetailsData[0].thumbnails.map(b => b.height)) == x.height).url

								//get small thumbnail
								let smallThumbnail = stimulusDetailsData[0].thumbnails.find(x => Math.min.apply(Math, stimulusDetailsData[0].thumbnails.map(b => b.height)) == x.height).url

								thumbnailObj.large_thumbnail = largeThumbnail
								thumbnailObj.small_thumbnail = smallThumbnail
							}
						} else {
							let creatorThumbparams = { Bucket: config.aws.s3Bucket, Key: `placeholders/creator_dashboard_thumbnail.svg` };
							let getSmallThumbnail: any = await s3_object_url(creatorThumbparams)

							let paramsLarge = { Bucket: config.aws.s3Bucket, Key: `placeholders/video-proccessing.png` };
							let getLargeThumbnail: any = await s3_object_url(paramsLarge)

							thumbnailObj.large_thumbnail = getLargeThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
							thumbnailObj.small_thumbnail = getSmallThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
						}
					} else {
						let dashboardThumbParams = { Bucket: config.aws.s3Bucket, Key: `placeholders/creator_dashboard_thumbnail.svg` };
						let getSmallThumbnail: any = await s3_object_url(dashboardThumbParams)

						let paramsLarge = { Bucket: config.aws.s3Bucket, Key: `placeholders/video-proccessing.png` };
						let getLargeThumbnail: any = await s3_object_url(paramsLarge)

						thumbnailObj.large_thumbnail = getLargeThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
						thumbnailObj.small_thumbnail = getSmallThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
					}
				} else {
					let onBoardParams = { Bucket: config.aws.s3Bucket, Key: `placeholders/creator_dashboard_thumbnail.svg` };
					let getSmallThumbnail: any = await s3_object_url(onBoardParams)

					let paramsLarge = { Bucket: config.aws.s3Bucket, Key: `placeholders/video-proccessing.png` };
					let getLargeThumbnail: any = await s3_object_url(paramsLarge)

					thumbnailObj.large_thumbnail = getLargeThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
					thumbnailObj.small_thumbnail = getSmallThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
				}

				//update thumbnail data
				await sessionRepository.update({ session_id: sessionResult.session_id }, thumbnailObj)

				// add trigger for 75 percent time
				if (scheduledstart && scheduledend) {
					let diffrence = moment(scheduledend).unix() - moment(scheduledstart).unix()
					if (diffrence) {
						let diffrence75 = Math.floor((diffrence * 75) / 100)
						if (diffrence75) {
							let newTimeWith75percent = moment(moment(scheduledstart).add(diffrence75, 'seconds')).utc().toISOString();
							if (newTimeWith75percent) {
								triggersObj.triggers.push({
									"event_id": "async-session-75percent-time",
									"time": newTimeWith75percent,
									"active": true
								})
							}
						}
					}
				}
			} else {
				logger.info(`This event ${sessionCode} is moderated`)
				let stimulusDetailsData = await stimulusDetails(getFindCustomer.customer_id, sessionCode, req.headers.idtoken);
				logger.info(`${sessionCode} stimulus details-->`, stimulusDetailsData)
				logger.info(`${sessionCode} stimulus thumbnails details-->`, stimulusDetailsData[0].thumbnails)
				let thumbnailObj = {
					small_thumbnail: "",
					large_thumbnail: ""
				}
				let randonNumber = Math.floor(Math.random() * 71) + 1;
				let smallPlaceholderparams = { Bucket: config.aws.s3Bucket, Key: `placeholders/small-${randonNumber}.svg` };
				let getSmallThumbnail: any = await s3_object_url(smallPlaceholderparams)

				let paramsLargePlaceholder = { Bucket: config.aws.s3Bucket, Key: `placeholders/large-${randonNumber}.svg` };
				let getLargeThumbnail: any = await s3_object_url(paramsLargePlaceholder)

				thumbnailObj.large_thumbnail = getLargeThumbnail.url.replace(/(\?.*)|(#.*)/g, "")
				thumbnailObj.small_thumbnail = getSmallThumbnail.url.replace(/(\?.*)|(#.*)/g, "")

				//update thumbnail data
				await sessionRepository.update({ session_id: sessionResult.session_id }, thumbnailObj)
				let before5mins = moment(moment(scheduledstart).subtract(9, 'minutes')).utc().toISOString();
				logger.info("before5mins " + sessionCode, before5mins);
				let after5mins = moment(moment(scheduledstart).add(5, 'minutes')).utc().toISOString();
				logger.info("after5mins ", after5mins);

				logger.info("moment(scheduledstart).utc().toISOString()---->", moment(scheduledstart).utc().toISOString())
				logger.info("moment().utc().toISOString()---->", moment().utc().toISOString())
				let difference = moment(moment(scheduledstart).utc().toISOString()).diff(moment().utc().toISOString(), 'seconds')
				logger.info(`Moderated difference--->`, difference)
				if (difference <= 300) {
					logger.info(`Moderated if--->`, difference)
					// Session within 5 mins then send push notification to all participants
					within5min = true
					triggersObj.triggers.push({
						"event_id": "mod-session-9mins-before",
						"time": newTimeWith30Secs,
						"active": true
					},
						{
							"event_id": "mod-session-5mins-after",
							"time": after5mins.toString(),
							"active": true
						})
				} else {
					logger.info(`Moderated else--->`, difference)
					triggersObj.triggers.push({
						"event_id": "mod-session-9mins-before",
						"time": before5mins.toString(),
						"active": true
					},
						{
							"event_id": "mod-session-5mins-after",
							"time": after5mins.toString(),
							"active": true
						})
				}
				logger.info("difference--->", difference)
				// mod session 10mins before
				if (difference > 600) {
					let before10mins = moment(moment(scheduledstart).subtract(10, 'minutes')).utc().toISOString();
					triggersObj.triggers.push({
						"event_id": "mod-session-10mins-before",
						"time": before10mins.toString(),
						"active": true
					})
				} else if (difference >= 60) {
					triggersObj.triggers.push({
						"event_id": "mod-session-10mins-before",
						"time": moment(moment().add(30, 'seconds')).utc().toISOString(),
						//"time": moment(moment(currentDate).add(30, 'seconds')).utc().toISOString(),
						"active": true
					})
				}
				// mod session 1min before
				let before1mins = moment(moment(scheduledstart).subtract(2, 'minutes')).utc().toISOString();
				if (difference > 120) {
					triggersObj.triggers.push({
						"event_id": "mod-session-1mins-before-notification-trigger",
						"time": before1mins.toString(),
						"active": true
					})
				}
			}
			if (moment(currentDate).unix() > moment(requestScheduledStart).unix()) {
				logger.info("Here is if part")

				//schdeule session after 1 minute if start date is past
				triggersObj.triggers.push({
					"event_id": "session-start",
					"time": newTimeWith1Minute,
					"active": true
				},{
					"event_id": "session-end",
					"time": scheduledend,
					"active": true
				})

				if (sessionType == "MODERATED") {
					triggersObj.triggers.push({
						"event_id": "mod-session-10mins-before",
						"time": moment(moment(currentDate).add(30, 'seconds')).utc().toISOString(),
						"active": true
					}, {
						"event_id": "mod-session-9mins-before",
						"time": moment(moment(currentDate).add(30, 'seconds')).utc().toISOString(),
						"active": true
					})
				}

				await addLogToAws({ 
					category:'info', 
					method:'createExperience', 
					message:`schedule session after 1 minute`, data:triggersObj
				});
				logger.info(`Here we trigger start and end for ${sessionCode}`, triggersObj)
			} else {
				//schedule start date is future
				logger.info("Here is else part")
				triggersObj.triggers.push({
					"event_id": "session-start",
					"time": scheduledstart,
					"active": true
				},{
					"event_id": "session-end",
					"time": scheduledend,
					"active": true
				})

				await addLogToAws({ 
					category:'info', 
					method:'createExperience', 
					message:`schedule session for future`, data:triggersObj
				});
			}

			// for send email after 10 minutes
			let endTimePlus10Minutes = moment(moment(scheduledend).add(600 + stimulus_video_length, 'seconds')).utc().toISOString();
			if (endTimePlus10Minutes) {
				triggersObj.triggers.push({
					"event_id": "session-complete-email-10mins",
					"time": endTimePlus10Minutes,
					"active": true
				})
			}
			try {
				logger.info("create experience triggersObj ==> ", triggersObj);
				await addLogToAws({ 
					category:'info', 
					method:'createExperience', 
					message:`Experience Trigger Details`, data:triggersObj
				});
				await schedule_session(getFindCustomer.customer_id, sessionCode, triggersObj, req.headers.idtoken)
			} catch (error) {
				let throwmessage = {
					deb_message: "getting error while schedule session",
					deb_where: "ExperienceResolver/createExperience"
				}
				newrelic.noticeError(error, throwmessage)
				console.log("getting error while schedule session--->", error)
				return { status: "false", messagecode: "", message: error.message, data: null };
			}

			// save surveylink
			if (surveylink) {
				const sessionMetricsRepository = tenantConnection.getRepository(SessionMetrics);
				let sesstionMetrics = await sessionMetricsRepository.findOne({
					session_id: sessionResult.session_id,
					metric_type: "SURVEYLINK"
				})
				let sessionMatricObject: Partial<SessionMetrics> = {
					survey_link: surveylink,
				};
				if (sesstionMetrics) {
					await sessionMetricsRepository.update({
						smetrics_id: sesstionMetrics.smetrics_id
					}, sessionMatricObject);
				} else {
					sessionMatricObject.session_id = sessionResult.session_id
					sessionMatricObject.metric_type = "SURVEYLINK"
					await sessionMetricsRepository.save(sessionMatricObject);
				}
			}

			//clear temporary_json
			userMetricsRepository.update({
				user_id: +user_id,
				metrics_value: "CREATOR_EXPERIENCE_BUILDER"
			}, { temporary_value: null })

			//add Participant
			let getAPItenant = await customerRepo.findOne({ where: { customer_id: getTenantData } });
			let user: any = await userRepository.createQueryBuilder("users")
				.where("users.username=:email", { email: req.body.email })
				.getOne();
			let roleAccess: any
			if (!!user && !!user.role_id) {
				roleAccess = await roleRepository.createQueryBuilder("roles")
				.leftJoinAndSelect("roles.accesspages", "accesspages")
				.where("roles.role_id=:role_id", { role_id: user.role_id })
					.andWhere('accesspages.access_name = :access_name', { access_name: 'recommend_tags' })
					.getOne();
				}
			let groupIds = []
			if (user) {
				const groups = await participantsGroupRepository.find({
					where: {
						department_id: user.department_id ? user.department_id : null
					}
				})
				groupIds = groups.map((obj) => { return obj.group_id })
			}
			let towerTag: boolean = false;
			let isNotSystemFlagged: boolean = false;
			if (user && !user.role_id && user.system_flagged) {
				towerTag = true
			} else if (!!roleAccess
				&& !!roleAccess.accesspages[0]
				&& roleAccess.accesspages[0].access_name == 'recommend_tags'
				&& roleAccess.accesspages[0].access_value) {
				towerTag = true
				isNotSystemFlagged = true
			}
			if (participants.length > 0) {
				await addLogToAws({
					category: 'info',
					method: 'createExperience',
					message: `Participants list for ${sessionCode}`,
					data: { participants: participants }
				});
				const getSubcategory = await categoriesRepository.findOne({
					where: {
						session_type: sessionType,
						subcategory: sessionSubCategory.toUpperCase(),
						category: sessionCategory.toUpperCase()
					}
				})
				let creatorCompany = "";
				if (getFindCustomer.department_id) {
					const getDepartment = await departmentRepository.findOne({
						department_id: getFindCustomer.department_id
					})
					if (getDepartment) {
						creatorCompany = getDepartment.department_alias
					}
				}
				const getLargeThumbnail = await sessionRepository.findOne({
					select: ["large_thumbnail"],
					where:{
						session_id: sessionResult.session_id
					}
				})
				await Promise.all(
					participants.map(async (value: any, index) => {
						return new Promise(async (resolve, reject) => {
							try {
								let userEmail = value.email.toLowerCase().trim();
								console.log("userEmail ", userEmail);
								let userTags: any = value.tags;
								let getPrevTags: any = await tenantParticipantsRepo.findOne({
									where: {
										temp_email: userEmail,
										department_id: user && user.department_id ? user.department_id : null 
									},
									order: {
										participant_id: 'DESC'
									}
								})
								console.log("getPrevTags ", getPrevTags);
								await addLogToAws({
									category: 'info',
									method: 'createExperience',
									message: `Get prev tags from tags_cloud`,
									data: { email: userEmail, getPrevTags: getPrevTags }
								});
								let getPrevTagsFromList: any = await participantGroupListRepo.findOne({
									where: {
										email: userEmail,
										group_id: In(groupIds)
									},
									order: {
										updated_at: 'DESC'
									}
								})
								console.log("getPrevTagsFromList ", getPrevTagsFromList);
								await addLogToAws({
									category: 'info',
									method: 'createExperience',
									message: `Get tags from participants list`,
									data: { email: userEmail, getPrevTagsFromList: getPrevTagsFromList }
								});
								if (!!getPrevTags || !!getPrevTagsFromList) {
									let prevTags = getPrevTags && getPrevTags.tag_cloud ? getPrevTags.tag_cloud : []
									let prevTagsList = getPrevTagsFromList && getPrevTagsFromList.tags ? getPrevTagsFromList.tags : []
									let updatedTags = prevTags.concat(JSON.parse(JSON.stringify(prevTagsList)));
									updatedTags = updatedTags.concat(JSON.parse(JSON.stringify(userTags)));
									userTags = [...updatedTags.reduce((map, obj) => map.set(obj.tag_name, obj), new Map()).values()]; //remove duplicate tags
									userTags = userTags.filter((t)=>t.tag_name !== '-')
									console.log("userTags ", userTags);
								}

								//find email is valid or not
								let checkEmailValid = await publicUserRepository.findOne({ where: { username: userEmail } });
								await addLogToAws({
									category: 'info',
									method: 'createExperience',
									message: `Get user from public users ${userEmail}`,
									data: { checkEmailValid: checkEmailValid }
								});
								console.log("checkEmailValid ", checkEmailValid);
								if (!!checkEmailValid) {
									//find tenant of participant email
									let getParticipantDetails = await customerRepo.findOne({ where: { customer_id: checkEmailValid.customer_id } });
									const participantConnection = await connection(getParticipantDetails.customer_name);
									const participantUser = participantConnection.getRepository(Users);
									let getParticipantUserData = await participantUser.findOne({ where: { username: userEmail } })
									console.log("getParticipantUserData ", getParticipantUserData);
									logger.info("getParticipantUserData ", getParticipantUserData);
									await addLogToAws({
										category: 'info',
										method: 'createExperience',
										message: `Get user from schema users ${userEmail}`,
										data: { getParticipantUserData: getParticipantUserData }
									});
									if (getParticipantUserData.active) {
										let participantObj: Partial<SessionParticipants> = {
											session_id: sessionResult.session_id,
											tag_cloud: userTags,
											department_id: getFindCustomer.department_id ? getFindCustomer.department_id : null
										};
										//check email exist or not
										let checkEmailExists = await tenantParticipantsRepo.findOne({
											where: { temp_email: userEmail, session_id: sessionResult.session_id }
										})
										if (!checkEmailExists) {
											participantObj = {
												...participantObj,
												temp_email: userEmail
											};
										}
										const tenantUserDevicesRepo = participantConnection.getRepository(UserDevices);
										let getUserDevices = await tenantUserDevicesRepo.find({
											where: { user_id: getParticipantUserData.user_id },
											order: { updated_at: "DESC" }
										});
										await addLogToAws({
											category: 'info',
											method: 'createExperience',
											message: `Get userdevice for ${userEmail}`,
											data: { getUserDevices: getUserDevices }
										});
										if (getUserDevices.length > 0) {
											if (within5min) {
												// send push notification to participant
												let type: string = ""
												let message: string = "START"
												let silentNotification: boolean = false
												if (getUserDevices[0].sensor_type == "BLE" || getUserDevices[0].sensor_type == "WE") {
													silentNotification = true
												}
												if (getUserDevices[0].phone.toLowerCase().indexOf("iphone") != -1) {
													type = "iphone"
												} else {
													type = "android"
												}
												let notificationData = {
													"message": message,
													"silent": silentNotification,
													"timetolive": 10,
													"priority": "high",
													"token": getUserDevices[0].phone_token,
													"token_type": type,
													"userschema": userEmail
												}
												try {
													let notiSend = await axios.post(`${config.notificationAPI}send_appnotify`, notificationData)
													if (notiSend) {
														config.log.log("Push notification send to participant within 5 mins --> ", notificationData)
													}
												} catch (error) {
													let throwmessage = {
														deb_message: "getting error while send pushnotification within 5 mins",
														deb_where: "ExperienceResolver/createExperience"
													}
													newrelic.noticeError(error, throwmessage)
													console.log("getting error while send pushnotification within 5 mins--->", error)
													return { status: "false", messagecode: "", message: error.message, data: null };
												}
											}
											if (getUserDevices.length > 1) {
												let getLastDevice = getUserDevices[0];
												Object.assign(participantObj,
													{
														// device_id : getLastDevice.device_id,
														identifier: getLastDevice.identifier,
														participant_status: "NOT_STARTED",
														last_step: "ADDED",
														last_step_at: new Date(),
													}
												)
											} else {
												let getLastDevice = getUserDevices[0];
												if (!!getLastDevice.identifier) {
													Object.assign(participantObj,
														{
															// device_id : getLastDevice.device_id,
															identifier: getLastDevice.identifier,
															participant_status: "NOT_STARTED",
															last_step: "ADDED",
															last_step_at: new Date(),
														}
													)
												} else {
													//get identifier from updated_at
													let getUserDevicesUpdatedAt = await tenantUserDevicesRepo.findOne({
														where: { user_id: getParticipantUserData.user_id },
														order: { updated_at: "DESC" }
													});
													Object.assign(participantObj,
														{
															// device_id : getUserDevicesUpdatedAt.device_id,
															identifier: getUserDevicesUpdatedAt.identifier,
															participant_status: "NOT_STARTED",
															last_step: "ADDED",
															last_step_at: new Date(),
														}
													)
												}
											}

										} else {
											Object.assign(participantObj,
												{
													participant_status: "NOT_STARTED",
													last_step: "ADDED",
													last_step_at: new Date(),
												}
											)
										}
										if (getParticipantUserData.customer_id == getAPItenant.customer_id) {
											//if both are same
											participantObj = {
												...participantObj,
												user_id: getParticipantUserData.user_id
											};
										}
										await addLogToAws({
											category: 'info',
											method: 'createExperience',
											message: `participant object to save in session participants`,
											data: { participantObj: participantObj }
										});
										let savedParticipant = await tenantParticipantsRepo.save(participantObj);
										//check status logs
										let statusLogsObj = [{
											date: moment().utc().toISOString(),
											participant_status: savedParticipant.participant_status,
											last_step: savedParticipant.last_step,
										}]
										await tenantParticipantsRepo.update({ participant_id: savedParticipant.participant_id }, { status_change: statusLogsObj })
										// update tags in participant list and all sessions
										await updateTagsAllPlace(userEmail, userTags, tenantConnection, user && user.department_id?user.department_id:null)
										
										//save to customer_session
										let customerSessionObj = {
											session_code: sessionResult.session_code,
											tenant: getParticipantUserData.customer_id,
											device_identifier: (getUserDevices.length > 0 ? getUserDevices[0].identifier : null),
											session_status: status,
											temp_email: userEmail,
											participant_status: participantObj.participant_status,
											session_type: sessionResult.session_type,
											started_at: sessionResult.started_at,
											scheduled_start_at: sessionResult.scheduled_start_at
										}
										await addLogToAws({
											category: 'info',
											method: 'createExperience',
											message: `participant object to save in customer_sessions`,
											data: { customerSessionObj: customerSessionObj }
										});
										logger.info("customerSessionObj ", customerSessionObj);
										await customerSessionRepo.save(customerSessionObj);

										if (!!userTags) {
											try {

												//update tags to tag master
												userTags.map(async (v, i) => {
													let checkTagExists = await tagsRepository.findOne({
														where: {
															tagName: ILike(v.tag_name),
															active: true,
															deleted: false,
															departmentId: getFindCustomer.department_id ? +getFindCustomer.department_id : null
														}
													})

													if (!checkTagExists) {
														let tag: Partial<Tags> = {
															tagName: v.tag_name,
															tagType: 1,
															systemTag: false,
															departmentId: getFindCustomer.department_id ? +getFindCustomer.department_id : null,
															creatorUserId: getFindCustomer.user_id ? +getFindCustomer.user_id : null,
														}

														await tagsRepository.save(tag);
													}
												})
											} catch (error) {
												let throwmessage = {
													deb_message: "Getting issue in add tag to master addParticioabts",
													deb_where: "ExperienceResolver/createExperience"
												}
												newrelic.noticeError(error, throwmessage)
												logger.info("Getting issue in add tag to master addParticioabts", error)
											}
										}

										// send email to participant
										let templateName = sessionType == "ASYNC" ? "async_experience_existing_user" : "mod_experience_existing_user"
										let modAsyncUrl = sessionType == "ASYNC" ? `${config.asyncFrontend}/install/${sessionResult.session_code}?email=${userEmail}` : `${config.moderatedFrontend}/install/${sessionResult.session_code}?email=${userEmail}`
										let wt: string = makeid(8)
										let linkobj = { sessioncode: sessionResult.session_code, webtoken: wt, sessiontype: sessionResult.session_type, email: encodeURIComponent(userEmail) }
										let linkDatabranch: any = await createDynamicLinkBranchIO(linkobj);
										if (!!linkDatabranch) {
											modAsyncUrl = linkDatabranch
											logger.info("modAsyncUrl ", modAsyncUrl);
										}
										let timezone = await getTimeZone(schemaname, getFindCustomer.user_id, userEmail)

										let getParticipant;
										let participant_tab_link = `${config.customerFrontend}/creator/experience-manager/participants/${sessionResult.session_code}?overview=true&session_code=${sessionResult.session_code}`;
										let overview_tab_link = `${config.customerFrontend}/creator/experience-manager/overview/${sessionResult.session_code}?overview=true`;
										const participantRoleAccess = participantConnection.getRepository(RoleAccess);
										const participantUsers = participantConnection.getRepository(Users);
										getParticipant = await participantUsers.findOne({
											where: {
												username: userEmail
											}
										})
										if (getParticipant) {
											const getRoleAccess = await participantRoleAccess.findOne({
												where: {
													role_id: getParticipant.role_id,
													access_name: 'trial_experiences',
													access_value: true
												}
											})
											if (getRoleAccess && getRoleAccess.access_value) {
												participant_tab_link = `${config.customerFrontend}/subscriber/creator/experience-manager/participants/${sessionResult.session_code}?overview=true&session_code=${sessionResult.session_code}`;
												overview_tab_link = `${config.customerFrontend}/subscriber/creator/experience-manager/overview/${sessionResult.session_code}?overview=true`;
											}
										}

										let templateData = {
											email: userEmail,
											creator_fname: capitalizeFirstLetter(getFindCustomer.first_name),
											creator_lname: capitalizeFirstLetter(getFindCustomer.last_name),
											creator_company: creatorCompany ? creatorCompany : '',
											creator_email_domain: getFindCustomer.username.split('@').pop(),
											participant_email: userEmail,
											participant_fname: getParticipantUserData ? capitalizeFirstLetter(getParticipantUserData.first_name) : "",
											participant_lname: getParticipantUserData ? capitalizeFirstLetter(getParticipantUserData.last_name) : "",
											experience_type: capitalizeFirstLetter(sessionResult.session_type),
											experience_subtype: getSubcategory ? getSubcategory.display_subcategory : '',
											experience_name: sessionResult.session_title,
											experience_id: sessionResult.session_code,
											experience_startdate: scheduledstart ? await getDateFormatString(moment(scheduledstart).unix(), timezone) : "",
											experience_enddate: scheduledend ? await getDateFormatString(moment(scheduledend).unix(), timezone) : "",
											experience_image: getLargeThumbnail ? getLargeThumbnail.large_thumbnail : sessionResult.large_thumbnail,
											experience_hours_left: secondsToDhms(moment().unix() - parseInt(sessionResult.scheduled_start_at)),
											inviter_fname: capitalizeFirstLetter(getFindCustomer.first_name),
											inviter_lname: capitalizeFirstLetter(getFindCustomer.last_name),
											accept_invitaion_link: modAsyncUrl,
											participant_tab_link: participant_tab_link,
											overview_tab_link: overview_tab_link,
											install_page_link: modAsyncUrl,
											experience_participant_completedate: scheduledend ? await getDateFormatString(moment(scheduledend).unix(), timezone) : ""
										}

										let sessionDetailsForMail = await sessionRepository.findOne({ session_code: sessionResult.session_code })
										if (sessionResult.session_type == 'ASYNC') {
											if (sessionDetailsForMail.stimulus_status == 'READY') {
												await sendEmail(templateName, templateData)
											}
										} else {
											await sendEmail(templateName, templateData)
										}
									}
								} else {
									let getPrevTags: any = await tenantParticipantsRepo.findOne({
										where: {
											department_id: getFindCustomer && getFindCustomer.department_id ? getFindCustomer.department_id : null,
											temp_email: userEmail
										},
										order: {
											participant_id: 'DESC'
										}
									})
									console.log("getPrevTags ", getPrevTags);
									let getPrevTagsFromList: any = await participantGroupListRepo.findOne({
										where: {
											email: userEmail,
											group_id: In(groupIds)
										},
										order: {
											updated_at: 'DESC'
										}
									})
									console.log("getPrevTagsFromList ", getPrevTagsFromList);
									if(!!getPrevTags || !!getPrevTagsFromList) {
										let prevTags = getPrevTags && getPrevTags.tag_cloud ? getPrevTags.tag_cloud : []
										let prevTagsList = getPrevTagsFromList && getPrevTagsFromList.tags ? getPrevTagsFromList.tags : []
										let updatedTags = prevTags.concat(JSON.parse(JSON.stringify(prevTagsList)));
										updatedTags = updatedTags.concat(JSON.parse(JSON.stringify(userTags)));
										userTags = [...updatedTags.reduce((map, obj) => map.set(obj.tag_name, obj), new Map()).values()]; //remove duplicate tags
										userTags = userTags.filter((tag)=> tag.tag_name !== '-')
										console.log("userTags ", userTags);
									}
									let participantObj: Object = {
										session_id: sessionResult.session_id,
										participant_status: "NOT_STARTED",
										last_step: "NEW_USER",
										temp_email: userEmail,
										last_step_at: new Date(),
										tag_cloud: userTags,
										department_id: getFindCustomer.department_id ? getFindCustomer.department_id : null
									};
									let savedParticipant = await tenantParticipantsRepo.save(participantObj);
									//check status logs
									let statusLogsObj = [{
										date: moment().utc().toISOString(),
										participant_status: savedParticipant.participant_status,
										last_step: savedParticipant.last_step,
									}]
									await tenantParticipantsRepo.update({ participant_id: savedParticipant.participant_id }, { status_change: statusLogsObj })
									await updateTagsAllPlace(userEmail, userTags, tenantConnection, getFindCustomer && getFindCustomer.department_id ? getFindCustomer.department_id : null)
									
									//save to customer_session
									let customerSessionObj = {
										session_code: sessionResult.session_code,
										tenant: null,
										session_status: status,
										temp_email: userEmail,
										participant_status: "NOT_STARTED",
										session_type: sessionResult.session_type,
										started_at: sessionResult.started_at,
										scheduled_start_at: sessionResult.scheduled_start_at
									}
									await customerSessionRepo.save(customerSessionObj);

									try {
										if (!!userTags) {

											//update tags to tag master
											userTags.map(async (v, i) => {
												let checkTagExists = await tagsRepository.findOne({
													where: {
														tagName: ILike(v.tag_name),
														active: true,
														deleted: false,
														departmentId: getFindCustomer.department_id ? +getFindCustomer.department_id : null
													}
												})

												if (!checkTagExists) {
													let tag: Partial<Tags> = {
														tagName: v.tag_name,
														tagType: 1,
														systemTag: false,
														departmentId: getFindCustomer.department_id ? +getFindCustomer.department_id : null,
														creatorUserId: getFindCustomer.user_id ? +getFindCustomer.user_id : null,
													}

													await tagsRepository.save(tag);
												}
											})
										}
									} catch (error) {
										let throwmessage = {
											deb_message: "Getting issue in add tag to master addParticioabts",
											deb_where: "ExperienceResolver/createExperience"
										}
										newrelic.noticeError(error, throwmessage)
										logger.info("Getting issue in add tag to master addParticioabts", error)
									}
									// send email to participant
									let templateName = sessionType == "ASYNC" ? "async_experience_new_user" : "mod_experience_new_user"
									let modAsyncUrl = sessionType == "ASYNC" ? `${config.asyncFrontend}/install/${sessionResult.session_code}?email=${userEmail}` : `${config.moderatedFrontend}/install/${sessionResult.session_code}?email=${userEmail}`
									let wt: string = makeid(8)
									let linkobj = { sessioncode: sessionResult.session_code, webtoken: wt, sessiontype: sessionType, email: encodeURIComponent(userEmail) }

									let linkDatabranch: any = await createDynamicLinkBranchIO(linkobj);
									if (!!linkDatabranch) {
										logger.info("modAsyncUrl ", modAsyncUrl);
										modAsyncUrl = linkDatabranch
									}
									let timezone = await getTimeZone(schemaname, getFindCustomer.user_id, userEmail)

									let participant_tab_link = `${config.customerFrontend}/creator/experience-manager/participants/${sessionResult.session_code}?overview=true&session_code=${sessionResult.session_code}`;
									let overview_tab_link = `${config.customerFrontend}/creator/experience-manager/overview/${sessionResult.session_code}?overview=true`;

									let templateData = {
										email: userEmail,
										creator_fname: capitalizeFirstLetter(getFindCustomer.first_name),
										creator_lname: capitalizeFirstLetter(getFindCustomer.last_name),
										creator_company: creatorCompany ? creatorCompany : '',
										creator_email_domain: getFindCustomer.username.split('@').pop(),
										participant_email: userEmail,
										participant_fname: "",
										participant_lname: "",
										experience_type: capitalizeFirstLetter(sessionResult.session_type),
										experience_subtype: getSubcategory ? getSubcategory.display_subcategory : '',
										experience_name: sessionResult.session_title,
										experience_id: sessionResult.session_code,
										experience_startdate: scheduledstart ? await getDateFormatString(moment(scheduledstart).unix(), timezone) : "",
										experience_enddate: scheduledend ? await getDateFormatString(moment(scheduledend).unix(), timezone) : "",
										experience_image: getLargeThumbnail ? getLargeThumbnail.large_thumbnail : sessionResult.large_thumbnail,
										experience_hours_left: secondsToDhms(moment().unix() - parseInt(sessionResult.scheduled_start_at)),
										inviter_fname: capitalizeFirstLetter(getFindCustomer.first_name),
										inviter_lname: capitalizeFirstLetter(getFindCustomer.last_name),
										accept_invitaion_link: modAsyncUrl,
										participant_tab_link: participant_tab_link,
										overview_tab_link: overview_tab_link,
										install_page_link: modAsyncUrl,
										experience_participant_completedate: scheduledend ? await getDateFormatString(moment(scheduledend).unix(), timezone) : "",
									}

									let sessionDetailsForMail = await sessionRepository.findOne({ session_code: sessionResult.session_code })
									if (sessionResult.session_type == 'ASYNC') {
										if (sessionDetailsForMail.stimulus_status == 'READY') {
											await sendEmail(templateName, templateData)
										}
									} else {
										await sendEmail(templateName, templateData)
									}

								}
								if(towerTag){
									await addParticipantsTowerData(userEmail,isNotSystemFlagged);
								}
								
								resolve(true)
							} catch (e) {
								await addLogToAws({
									category: 'error',
									method: 'createExperience',
									message: `${e}`,
									data: { error: e.stack }
								});
								resolve(true)
							}
						})
					})
				)
			}

			//save agenda_json to session marker
			if (!!agendaJson) {
				if (!!agendaJson.schedules)
					if (agendaJson.schedules.length > 0) {
						let getDeffirence = moment(scheduledend).diff(moment(scheduledstart), 'seconds') / agendaJson.schedules.length;
						let getDefaulAgenda = this.createDefaulAgenda(getDeffirence, scheduledstart, user_id, sessionResult.session_id, agendaJson.schedules)
						logger.info(`getDefaulAgenda---> ${sessionCode}`, getDefaulAgenda)
						await addLogToAws({ 
							category:'info', 
							method:'createExperience', 
							message:`Agenda Markers ${sessionCode}`, data:getDefaulAgenda
						});
						await sessionMarkerRepository.save(getDefaulAgenda); //save agenda json details
					} else {
						let defaultAgenda = ["Beginning", "Middle", "End"]
						// save default marker
						let getDeffirence = moment(scheduledend).diff(moment(scheduledstart), 'seconds') / defaultAgenda.length;
						let getDefaulAgenda = this.createDefaulAgenda(getDeffirence, scheduledstart, user_id, sessionResult.session_id, defaultAgenda)
						await addLogToAws({ 
							category:'info', 
							method:'createExperience', 
							message:`Agenda Markers ${sessionCode} else`, data:getDefaulAgenda
						});
						logger.info(`getDefaulAgenda---> ${sessionCode}`, getDefaulAgenda)
						await sessionMarkerRepository.save(getDefaulAgenda); //save agenda json details
					}
			}

			let getSessionCount = await sessionRepository.count({
				where: {
					owner_user_id: user_id
				}
			})

			if (getSessionCount === 1) {
				try {
					await createBraintrustResults(schemaname, getFindCustomer, req.headers.idtoken)
				} catch (braintrustErr) {
					console.log("braintrust results error-->",braintrustErr)
					logger.info("braintrust results error-->",braintrustErr)
				}
			}

			let getSessionTest = await sessionRepository.findOne({ session_code: sessionResult.session_code })
			console.log("getSessionTest ", getSessionTest);
			logger.info("getSessionTest ", getSessionTest);
			if (braintrust_id) {
				try {
					console.log("inside braintrust");
					logger.info("inside braintrust");
					await createBraintrustSimulate(schemaname, getFindCustomer, req.headers.idtoken, braintrust_id, sessionResult, braintrust_demo)
				} catch (braintrustError) {
					console.log("braintrust simulate error-->",braintrustError)
					logger.info("braintrust simulate error-->",braintrustError)
				}
			}
			console.log("after braintrust")
			logger.info("after braintrust")
			returnResult = { status: true, messagecode: "experienceCreated", message: "Experience created successfully" };
			return returnResult;
		} catch (error) {
			await addLogToAws({ category: 'error', method: 'createExperience', message: 'Getting issue on createExperience', data: error }); //aws logs
			let throwmessage = {
				deb_message: "Getting issue on createExperience",
				deb_where: "ExperienceResolver/createExperience"
			}
			newrelic.noticeError(error, throwmessage)
			console.log("error--->", error)
			returnResult = { status: "false", messagecode: "", message: error.message };
			return returnResult;
		}
	}

	/**
	 * delete of experiences
	 * @param {[string]} session_title
	 * @returns {CommonResponse}
	 */
	@Mutation(returns => CommonResponse)
	async deleteExperiences(@Ctx() { req },
		@Arg('session_code', type => [String]) sessionCode: [string]
	): Promise<CommonResponse<any> | undefined> {
		let returnResult: CommonResponse<[]>;
		try {
			const schemaname = !!req.body.schemaname ? req.body.schemaname : req.headers.schemaname
			const publicConnection = await connection("public");
			const tenantConnection = await connection(schemaname);
			const customerSessionsRepo = publicConnection.getRepository(CustomerSessions);
			const tenantSessionRepo = tenantConnection.getRepository(Sessions);
			const tenantUserRepo = tenantConnection.getRepository(Users);
			let tenant = await tenantUserRepo.findOne({ username: req.body.email })
			let sessions = await tenantSessionRepo.createQueryBuilder("sessions")
				.update()
				.set({
					session_status: "CANCELLED",
					cancelled_at: moment().utc().toISOString(),
					deleted_at: moment().utc().toISOString(),
					updated_at: moment().utc().toISOString()
				})
				.where("sessions.session_code IN (:...session_codes)", { session_codes: sessionCode })
				.returning('*')
				.execute();
			await customerSessionsRepo.createQueryBuilder("customer_sessions")
				.update()
				.set({
					active: false,
					updated_at: moment().utc().toISOString()
				})
				.where("customer_sessions.session_code IN (:...session_codes)", { session_codes: sessionCode })
				.execute();
			if (sessions.raw.length > 0) {
				sessions.raw.map(async (val) => {
					if (val.session_status == "LIVE" || val.session_status == "UPCOMING") {
						let scheduleSessionData = {
							"tenant_id": tenant.customer_id,
							"session_code": val.session_code,
							"triggers": [
								{
									"event_id": "session-cancelled",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "session-start",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "session-end",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "mod-session-9mins-before",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "mod-session-5mins-after",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "session-complete-email-10mins",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "async-session-75percent-time",
									"time": moment().utc().toISOString(),
									"active": false
								},
								{
									"event_id": "mod-session-10mins-before",
									"time": moment().utc().toISOString(),
									"active": false
								},
							],
							"entry_time": moment().unix()
						}
						await schedule_session(tenant.customer_id, val.session_code, scheduleSessionData, req.headers.idtoken)
					}

					//removeing deleted session from reel_session array
					var deletedSessionExistInReelSession = await tenantSessionRepo.createQueryBuilder("sessions")
					.where("sessions.reel_sessions @> :reel_sessions", { reel_sessions:val.session_id.toString() })
					.getMany();
					
					if(deletedSessionExistInReelSession.length > 0){
						await Promise.all(deletedSessionExistInReelSession.map(async (session) => {
							let parsedArray = JSON.parse(JSON.stringify(session.reel_sessions))
							const index = parsedArray.indexOf(+val.session_id);
							if (index > -1) {
								parsedArray.splice(index, 1);
								await tenantSessionRepo.update({ "session_id": +session.session_id }, {
									reel_sessions: parsedArray.length?parsedArray:null
								})
							}
						}))
						
					}
				})
			}
			returnResult = { status: true, messagecode: 200, message: "Session experience deleted", data: sessions.raw };
			return returnResult;
		} catch (error) {
			await addLogToAws({ category: 'error', method: 'deleteExperiences', message: 'Getting issue on deleteExperiences', data: error.stack }); //aws logs
			let throwmessage = {
				deb_message: "Getting issue on deleteExperience",
				deb_where: "ExperienceResolver/deleteExperience"
			}
			newrelic.noticeError(error, throwmessage)
			console.log("error---->", error)
			returnResult = { status: false, messagecode: 501, message: error.message };
			return returnResult;
		}
	}

	/**
	 * rename of experiences
	 * @param {string} session_title
	 * @param {string} session_idn
	 * @returns {CommonResponse}
	 */
	@Mutation(returns => CommonResponse)
	async renameExperience(@Ctx() { req },
		@Arg("session_title") session_title: string,
		@Arg("session_id") session_id: string,
	): Promise<CommonResponse<any> | undefined> {
		let returnResult: CommonResponse<[]>;
		if (!session_title) {
			returnResult = { status: true, messagecode: 501, message: "Experience title not provided" };
			return returnResult;
		}
		try {
			const schemaname = !!req.body.schemaname ? req.body.schemaname : req.headers.schemaname
			const tenantConnection = await connection(schemaname);
			const tenantSessionRepo = tenantConnection.getRepository(Sessions);

			await tenantSessionRepo.update({ "session_id": +session_id }, {
				session_title: session_title
			})

			returnResult = { status: true, messagecode: 200, message: "Experience rename successfully" };
			return returnResult;
		} catch (error) {
			let throwmessage = {
				deb_message: "Getting issue on renameExperience",
				deb_where: "ExperienceResolver/renameExperience"
			}
			newrelic.noticeError(error, throwmessage)
			console.log("error---->", error)
			returnResult = { status: false, messagecode: 501, message: error.message };
			return returnResult;
		}
	}

	/**
	 * Get list of all experiences
	 * @param {string} user_id
	 * @param {number} pageNo
	 * @param {number} size
	 * @param {string} orderBy
	 * @param {string} orderColumn
	 * @returns {searchExperience}
	 */
	@Query(returns => listExperience, { nullable: true })
	async listExperiences(
		@Ctx() { req },
		@Arg("user_id") user_id: string,
		@Arg("page_no") pageNo: number,
		@Arg("size") size: number,
		@Arg("sort_direction", { nullable: true }) orderBy: string,
		@Arg("sort_column", { nullable: true }) orderColumn: string,
		@Arg('session_ids', type => [String], { nullable: true }) session_ids: string[],
	): Promise<listExperience | undefined> {
		try {
			if (!user_id || !pageNo || !size) {
				throw new Error("Required field missing");
			}

			let schema = req.headers.schemaname ? req.headers.schemaname : req.body.schemaname
			const masterConnection = await connection(schema);
			const publicConnection = await connection("public");
			const customersRepository = publicConnection.getRepository(Customers);
			const customersDepartmentRepository = publicConnection.getRepository(CustomerDepartments);
			const sessionParticipantRepository = masterConnection.getRepository(SessionParticipants)
			const sessionsRepository = masterConnection.getRepository(Sessions)
			let returnResult = new listExperience();
			//call search api
			let getCustomerData = await customersRepository.findOne({where:{customer_name:schema}});
			
			let requestBody:any = {
				"tenant_id" : getCustomerData.customer_id,
				"search_entity" : "session",
				"across_tenant" : true,
				"page_no": !!pageNo ? pageNo : 1,
				"size": !!size ? size : 20
			}
			//apply sorting if getting value
			if (!!orderBy) {
				requestBody = {
					...requestBody,
					sort_direction: orderBy,
					sort_column: orderColumn
				}
			}
			if (session_ids && session_ids.length) {
				requestBody = {
					...requestBody,
					session_ids: session_ids
				}
			}
			const userRepository = masterConnection.getRepository(Users);
			let getUserData = await userRepository.findOne({ user_id: +user_id });
			//get department of user
			let getDepartmentData = await customersDepartmentRepository.findOne({
				where: {
					department_id: getUserData.department_id
				}
			})

			console.log("Here is department data===>", getDepartmentData)
			if (!!getUserData) {
				if (getUserData.system_flagged == true) {

					requestBody = {
						...requestBody,
						across_tenant: false
					}
					console.log("requestBody===> if system_flagged", requestBody)
					try {
						let getSessionData: any = await search(getCustomerData.customer_id, requestBody, req.headers.idtoken)
						if (typeof getSessionData != "object") {
							returnResult.count = 0;
							returnResult.sessions = [];
							return returnResult;
						}
						returnResult.count = getSessionData.record_count;
						returnResult.show_user_column = true;

						let getTenantExperience: Partial<Array<expeienceSearch>> = getSessionData.items

						let getExperieneDetails = getTenantExperience.map(async (value, index) => {
							return new Promise(async(resolve)=>{
								//find session data
								let getSessionDetails = await sessionsRepository.findOne({
									where: {
										session_id: value.session_id
									},
									relations: ['user']
								})

								if (!!getSessionDetails) {
									value.user = getSessionDetails.user
									//add extra data
									value.project_id = getSessionDetails.project_id
									value.session_description = getSessionDetails.session_description
									//change date to unix
									value.completed_at = !!getSessionDetails.completed_at ? moment(value.completed_at).unix() : null
									value.started_at = !!getSessionDetails.started_at ? moment(value.started_at).unix() : null
									value.ended_at = !!getSessionDetails.ended_at ? moment(value.ended_at).unix() : null
									value.scheduled_start_at = moment(value.scheduled_start_at).unix()
									value.scheduled_end_at = moment(value.scheduled_end_at).unix()
									value.session_trim_from = !!getSessionDetails.session_trim_from ? getSessionDetails.session_trim_from : null
									value.session_trim_to = !!getSessionDetails.session_trim_to ? getSessionDetails.session_trim_to : null

									//get thumbnail data
									value.small_thumbnail = getSessionDetails.small_thumbnail;
									value.large_thumbnail = getSessionDetails.large_thumbnail;

									//get participant counts
									value.participantscount = await sessionParticipantRepository.count({
										where: {
											session_id: value.session_id,
											participant_status: In(["COMPLETED","LIVE"]),
										}
									})

									let stimulusDetailsData = await stimulusDetails(getSessionDetails.customer_id, getSessionDetails.session_code, req.headers.idtoken);
									if (!!stimulusDetailsData[0]) {
										if(getSessionDetails.session_type == "ASYNC"){
											if (!!stimulusDetailsData[0].stimulus_video_length) {
												value.session_length = stimulusDetailsData[0].stimulus_video_length;
											}
										}
										value.stimulus_type = stimulusDetailsData[0].stimulus_type == 'AUDIO' ? 'AUDIO' : null;
										value.stimulus_status = stimulusDetailsData[0].stimulus_status ? stimulusDetailsData[0].stimulus_status : null
									}

									if(!!getSessionDetails.session_type && getSessionDetails.session_type == "MODERATED"){
										if (getSessionDetails.session_status == "UPCOMING") {
											let duration: any = moment.unix(parseInt(getSessionDetails.scheduled_end_at)).diff(moment.unix(parseInt(getSessionDetails.scheduled_start_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (getSessionDetails.session_status == "LIVE") {
											let duration: any = moment.unix(parseInt(getSessionDetails.scheduled_end_at)).diff(moment.unix(parseInt(getSessionDetails.started_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (getSessionDetails.session_status == "COMPLETED") {
											let duration: any = moment.unix(parseInt(getSessionDetails.ended_at)).diff(moment.unix(parseInt(getSessionDetails.started_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (!!getSessionDetails.session_trim_from && !!getSessionDetails.session_trim_to) {
											let duration: any = moment.unix(parseInt(getSessionDetails.session_trim_to)).diff(moment.unix(parseInt(getSessionDetails.session_trim_from)), 'seconds');
											value.session_length = `${duration}`
										}
									}

									//project folders
									value.project_folders = getSessionDetails.project_folders
									resolve(value);
								} else {
									resolve({})
								}
							})
						})
						let getExpData: any = await Promise.all(getExperieneDetails);
						let filterData = getExpData.filter((x) => {
							if (Object.keys(x).length > 0)
								return x
						})
						returnResult.sessions = filterData;
						return returnResult;
					} catch (error) {
						await addLogToAws({ category: 'error', method: 'listExperiences', message: 'getting issue in listExperiences if/catch', data: error.stack });
						logger.info("error==>", error)
						throw new Error(error);
					}

				} else {
					//check department sharing is on/off
					if (!!getDepartmentData) {
						if (getDepartmentData.sharing == true) {
							//get all creator from tenant
							let allCreatorData = await userRepository.createQueryBuilder("users")
							.select("users.user_id","user_id")
							.leftJoin("users.roles","roles")
							.leftJoin("roles.accesspages","accesspages")
							.where("accesspages.access_name IN (:...access)",{access:["experience_builder","trial_builder"]})
							.andWhere("accesspages.access_value = :accessvalue",{accessvalue:true})
							.andWhere("users.department_id = :department_id",{department_id:getDepartmentData.department_id})
							.getRawMany();
							console.log("allCreatorData")
							let allCreator = allCreatorData.map(x=>x.user_id)
							if(allCreator.length>0){
								returnResult.show_user_column=true
								requestBody = {...requestBody,
									across_tenant : false,
									owner_user_ids : allCreator
								}
							} else {
								console.log("comes here");
								requestBody = {
									...requestBody,
									across_tenant: false,
									owner_user_id: +getUserData.user_id
								}
							}
						} else {
							returnResult.show_user_column = false
							requestBody = {
								...requestBody,
								across_tenant: false,
								owner_user_id: +getUserData.user_id
							}
						}
					} else {
						returnResult.show_user_column = false
						requestBody = {
							...requestBody,
							across_tenant: false,
							owner_user_id: +getUserData.user_id
						}
					}

					console.log("requestBody----->",requestBody)
					logger.info("requestBody===> if not system_flagged",requestBody)

					try {
						let getSessionData: any = await search(getCustomerData.customer_id, requestBody, req.headers.idtoken)
						if (typeof getSessionData != "object") {
							returnResult.count = 0;
							returnResult.sessions = [];
							return returnResult;
						}
						returnResult.count = getSessionData.record_count;
						// returnResult.show_user_column=false
						if (!!requestBody.owner_user_ids) {
							let ownerUsersId:any = requestBody.owner_user_ids
							let anotherUserData:object[] = getSessionData.items.filter((x:Partial<Sessions>)=> ownerUsersId.filter(y=>y!=getUserData.user_id).includes(String(x.owner_user_id)))
							if (anotherUserData.length) {
								// returnResult.show_user_column=true
							}
						}

						let getExperieneDetails = getSessionData.items.map(async (value, index) => {
							return new Promise(async (resolve) => {
								//find session data
								let getSessionDetails = await sessionsRepository.findOne({
									where: {
										session_id: value.session_id
									},
									relations: ["user"]
								})

								if (!!getSessionDetails) {
									value.user = getSessionDetails.user
									//add extra data
									value.project_id = getSessionDetails.project_id
									value.session_description = getSessionDetails.session_description
									//change date to unix
									value.completed_at = !!getSessionDetails.completed_at ? moment(value.completed_at).unix() : null;
									value.started_at = !!getSessionDetails.started_at ? moment(value.started_at).unix() : null
									value.ended_at = !!getSessionDetails.ended_at ? moment(value.ended_at).unix() : null
									value.scheduled_start_at = moment(value.scheduled_start_at).unix()
									value.scheduled_end_at = moment(value.scheduled_end_at).unix()
									value.session_trim_from = !!getSessionDetails.session_trim_from ? getSessionDetails.session_trim_from : null
									value.session_trim_to = !!getSessionDetails.session_trim_to ? getSessionDetails.session_trim_to : null

									//get thumbnail data
									value.small_thumbnail = getSessionDetails.small_thumbnail;
									value.large_thumbnail = getSessionDetails.large_thumbnail;

									//get participant counts
									value.participantscount = await sessionParticipantRepository.count({
										where: {
											session_id: value.session_id,
											participant_status: In(["COMPLETED","LIVE"]),
										}
									})

									let stimulusDetailsData = await stimulusDetails(getSessionDetails.customer_id, getSessionDetails.session_code, req.headers.idtoken);
									if (!!stimulusDetailsData[0]) {
										if(getSessionDetails.session_type == "ASYNC"){
											if (!!stimulusDetailsData[0].stimulus_video_length) {
												value.session_length = stimulusDetailsData[0].stimulus_video_length;
											}
										}
										value.stimulus_type = stimulusDetailsData[0].stimulus_type == 'AUDIO' ? 'AUDIO' : null
										value.stimulus_status = stimulusDetailsData[0].stimulus_status ? stimulusDetailsData[0].stimulus_status : null
									}

									if(!!getSessionDetails.session_type && getSessionDetails.session_type == "MODERATED"){
										if (getSessionDetails.session_status == "UPCOMING") {
											let duration: any = moment.unix(parseInt(getSessionDetails.scheduled_end_at)).diff(moment.unix(parseInt(getSessionDetails.scheduled_start_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (getSessionDetails.session_status == "LIVE") {
											let duration: any = moment.unix(parseInt(getSessionDetails.scheduled_end_at)).diff(moment.unix(parseInt(getSessionDetails.started_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (getSessionDetails.session_status == "COMPLETED") {
											let duration: any = moment.unix(parseInt(getSessionDetails.ended_at)).diff(moment.unix(parseInt(getSessionDetails.started_at)), 'seconds');
											value.session_length = `${duration}`
										}
										if (!!getSessionDetails.session_trim_from && !!getSessionDetails.session_trim_to) {
											let duration: any = moment.unix(parseInt(getSessionDetails.session_trim_to)).diff(moment.unix(parseInt(getSessionDetails.session_trim_from)), 'seconds');
											value.session_length = `${duration}`
										}
									}
									
									//project folders
									value.project_folders = getSessionDetails.project_folders
									resolve(value);
								} else {
									resolve({})
								}
							})
						})
						let getExpData: any = await Promise.all(getExperieneDetails);
						let filterData = getExpData.filter((x) => {
							if (Object.keys(x).length > 0)
								return x
						})
						returnResult.sessions = filterData;

						// owner experience
						const ownerSessionCount = await sessionsRepository.count({
							where: {
								braintrust_id: null,
								owner_user_id: user_id
							}
						})
						returnResult.ownerSessionCount = ownerSessionCount

						return returnResult;
					} catch (error) {
						await addLogToAws({ category: 'error', method: 'listExperiencesNEW', message: 'getting issue in listExperiencesNEW else/catch', data: error.stack });
						console.log(error)
						throw new Error(error);
					}
				}
			}else{
				await addLogToAws({ category: 'error', method: 'listExperiencesNEW', message: 'user not found try/if/else', data: `User not found ${req.body.email}` });
				throw new Error("User not found");
			}
		} catch (error) {
			await addLogToAws({ category: 'error', method: 'listExperiencesNEW', message: 'getting issue in listExperiencesNEW try/catch', data: error.stack });
			logger.info(`Getting error while get experience of user ${user_id}`,error);
			console.log(`Getting error while get experience of user ${user_id}`,error);
			throw new Error(error);
		}
	}
	

	/**
	 * Mark experience as cancelled
	 * @param {*} {req}
	 * @param {string} user_id
	 * @param {string} session_id
	 * @returns {Customtype}
	 */
	@Mutation(returns => Customtype)
	async cancelExperience(
		@Ctx() { req },
		@Arg("user_id") user_id: string,
		@Arg("session_id") session_id: string,
	): Promise<Customtype | undefined> {
		let returnResult;
		let currentTime: string = moment().utc().toISOString()
		try {
			const masterConnection = await connection(req.headers.schemaname);
			const sessionRepository = await masterConnection.getRepository(Sessions);
			const usersRepository = await masterConnection.getRepository(Users);
			//connection of global
			const globalConnection = await connection("public");
			const customerSessionRepository = globalConnection.getRepository(CustomerSessions);
			let getExperience = await sessionRepository.findOne({ 'session_id': +session_id });
			if (!getExperience) {
				throw new Error("Experience does not found");
			}

			if (getExperience.session_status == "CANCELLED") {
				throw new Error("Experience already cancelled");
			}
			//cancel scheduler
			let getFindCustomer = await usersRepository.findOne({ user_id: +user_id })
			let scheduleSessionData = {
				"tenant_id": getFindCustomer.customer_id,
				"session_code": getExperience.session_code,
				"triggers": [
					{
						"event_id": "session-cancelled",
						"time": currentTime,
						"active": false
					},
					{
						"event_id": "session-start",
						"time": currentTime,
						"active": false
					},
					{
						"event_id": "session-end",
						"time": currentTime,
						"active": false
					},
					{
						"event_id": "mod-session-9mins-before",
						"time": currentTime,
						"active": false
					},
					{
						"event_id": "mod-session-5mins-after",
						"time": currentTime,
						"active": false
					}
				],
				"entry_time": moment().unix()
			}
			try {
				await schedule_session(getFindCustomer.customer_id, getExperience.session_code, scheduleSessionData, req.headers.idtoken)
			} catch (error) {
				return { status: "false", messagecode: "", message: error.message, data: null };
			}

			let sessionObject: Partial<Sessions> = {
				"session_status": "CANCELLED",
				"cancelled_at": currentTime,
				"updated_by": +user_id,
				"updated_at": moment().utc().toISOString(),
			};
			await sessionRepository.update({ 'session_id': +session_id }, sessionObject); //update session
			//update status to global table
			customerSessionRepository.update({
				session_code: getExperience.session_code
			}, {
				session_status: "CANCELLED",
				updated_at: moment().utc().toISOString(),
			})
			returnResult = { status: "true", messagecode: "experienceCancelled", message: "" };
			return returnResult;
		} catch (error) {
			returnResult = { status: "false", messagecode: "", message: error.message };
			return returnResult;
		}
	}

	/**
	 * Update experience
	 * @param {*} {req}
	 * @param {string} user_id
	 * @param {string} session_id
	 * @param {string} title
	 * @param {string} description
	 * @param {string} scheduledstart
	 * @param {string} scheduledend
	 * @param {number} projectId
	 * @returns {Customtype}
	 */
	@Mutation(returns => Customtype)
	async editExperience(
		@Ctx() { req },
		@Arg("user_id") user_id: string,
		@Arg("session_id") session_id: string,
		@Arg("title") title: string,
		@Arg("description") description: string,
		@Arg("scheduled_start") scheduledstart: string,
		@Arg("scheduled_end", { nullable: true }) scheduledend: string,
		@Arg("project_id", { nullable: true }) projectId: number,
	): Promise<Customtype | undefined> {
		let returnResult;
		try {
			const publicConnection = await connection("public")
			const customerSessionsRepository =  publicConnection.getRepository(CustomerSessions);
			const masterConnection = await connection(!!req.body.schemaname ? req.body.schemaname : req.headers.schemaname);
			const sessionRepository = masterConnection.getRepository(Sessions);
			const sessionMarkerRepository = masterConnection.getRepository(SessionMarkers);
			const usersRepository = masterConnection.getRepository(Users);
			//find experience is exist
			let getExperience = await sessionRepository.findOne({ "session_id": +session_id });

			//logs
			await addLogToAws({ 
				category:'info', 
				method:'editExperience', 
				message:`Edit experience ${session_id}`, data:getExperience
			});
			if (!!getExperience) {
				let sessionObject: Partial<Sessions> = {
					"session_title": title,
					"session_description": description,
					"updated_by": +user_id,
					"project_id": projectId,
					"updated_at": moment().utc().toISOString(),
				};
				let getFindCustomer = await usersRepository.findOne({ user_id: +user_id })
				if (getExperience.session_status == "COMPLETED") {
					returnResult = { status: "false", messagecode: "experienceCompleted", message: "Experience Completed" }
					return returnResult;
				}
				let stimulus_video_length = 0
				if (getExperience.session_type == "ASYNC") {
					let stimulusDetailsData = await stimulusDetails(getFindCustomer.customer_id, getExperience.session_code, req.headers.idtoken);
					if (!!stimulusDetailsData && !!stimulusDetailsData[0]) {
						if (stimulusDetailsData[0].stimulus_video_length && parseInt(stimulusDetailsData[0].stimulus_video_length) > 0) {
							stimulus_video_length = parseInt(stimulusDetailsData[0].stimulus_video_length)
						}
					}
				}
				if (getExperience.session_status == "UPCOMING") {
					Object.assign(sessionObject, {
						scheduled_start_at: moment(moment(scheduledstart).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
						scheduled_end_at: (!!scheduledend ? moment(moment(scheduledend).format('YYYY-MM-DD hh:mm a')).utc().toISOString() : null)
					})

					//update scheduler
					if (moment(scheduledend).utc().toISOString() !== moment(getExperience.scheduled_end_at).utc().toISOString() && !!scheduledend) {
						//moment(scheduledstart).format('YYYY-MM-DD hh:mm a')
						let triggersObj: any = [{
							"event_id": "session-start",
							"time": moment(moment(scheduledstart).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
							"active": true
						},
						{
							"event_id": "session-end",
							"time": moment(moment(scheduledend).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
							"active": true
						}]
						let difference = moment(moment(scheduledstart).utc().toISOString()).diff(moment().utc().toISOString(), 'seconds')
						let before9mins = moment(moment(scheduledstart).subtract(9, 'minutes')).utc().toISOString();
						let after5mins = moment(moment(scheduledstart).add(5, 'minutes')).utc().toISOString();
						let now30secBefore = moment(moment(scheduledstart).add(30, 'seconds')).utc().toISOString();
						if (getExperience.session_type == "MODERATED") {
							if (difference <= 300) {
								// trigger notification right now
								triggersObj.push({
									"event_id": "mod-session-9mins-before",
									"time": now30secBefore,
									"active": true
								}, {
									"event_id": "mod-session-5mins-after",
									"time": after5mins,
									"active": true
								})
							} else {
								// Edit before 5mins notification trigger
								triggersObj.push({
									"event_id": "mod-session-9mins-before",
									"time": before9mins,
									"active": true
								}, {
									"event_id": "mod-session-5mins-after",
									"time": after5mins,
									"active": true
								})
							}
							// mod session 10mins before
							if (difference > 600) {
								let before10mins = moment(moment(scheduledstart).subtract(10, 'minutes')).utc().toISOString();
								triggersObj.push({
									"event_id": "mod-session-10mins-before",
									"time": before10mins.toString(),
									"active": true
								})
							} else if (difference >= 60) {
								triggersObj.push({
									"event_id": "mod-session-10mins-before",
									"time": moment(moment().add(30, 'seconds')).utc().toISOString(),
									"active": true
								})
							}
							// mod session 1min before
							let before1mins = moment(moment(scheduledstart).subtract(2, 'minutes')).utc().toISOString();
							if (difference > 120) {
								triggersObj.push({
									"event_id": "mod-session-1mins-before-notification-trigger",
									"time": before1mins.toString(),
									"active": true
								})
							}
						} else {
							// add trigger for 75 percent time
							if (scheduledstart && scheduledend) {
								let diffrence = moment(scheduledend).unix() - moment(scheduledstart).unix()
								if (diffrence) {
									let diffrence75 = Math.floor((diffrence * 75) / 100)
									if (diffrence75) {
										let newTimeWith75percent = moment(moment(scheduledstart).add(diffrence75, 'seconds')).utc().toISOString();
										if (newTimeWith75percent) {
											triggersObj.push({
												"event_id": "async-session-75percent-time",
												"time": newTimeWith75percent,
												"active": true
											})
										}
									}
								}
							}
						}
						console.log("triggersObj000>", triggersObj)
						// for send email after 10 minutes
						let endTimePlus10Minutes = moment(moment(scheduledend).add(600 + stimulus_video_length, 'seconds')).utc().toISOString();
						if (endTimePlus10Minutes) {
							triggersObj.push({
								"event_id": "session-complete-email-10mins",
								"time": endTimePlus10Minutes,
								"active": true
							})
						}
						let scheduleSessionData = {
							"tenant_id": getFindCustomer.customer_id,
							"session_code": getExperience.session_code,
							"triggers": triggersObj,
							"entry_time": moment().unix()
						}
						console.log("scheduleSessionData--->", scheduleSessionData)
						try {
							//logs
							await addLogToAws({ 
								category:'info', 
								method:'editExperience', 
								message:`Edit experience ${session_id} trigger schedule`, data:scheduleSessionData
							});
							await schedule_session(getFindCustomer.customer_id, getExperience.session_code, scheduleSessionData, req.headers.idtoken)
						} catch (error) {
							return { status: "false", messagecode: "", message: error.message, data: null };
						}
					} else if (scheduledend == "" || scheduledend == null) {
						let getFindCustomer = await usersRepository.findOne({ user_id: +user_id })
						let scheduleSessionData = {
							"tenant_id": getFindCustomer.customer_id,
							"session_code": getExperience.session_code,
							"triggers": [
								{
									"event_id": "session-start",
									"time": moment(moment(scheduledstart).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
									"active": true
								}
							],
							"entry_time": moment().unix()
						}
						if (getExperience.session_type == "ASYNC") {
							// add trigger for 75 percent time
							if (scheduledstart && getExperience.scheduled_end_at) {
								let diffrence = Number(getExperience.scheduled_end_at) - moment(scheduledstart).unix()
								if (diffrence) {
									let diffrence75 = Math.floor((diffrence * 75) / 100)
									if (diffrence75) {
										let newTimeWith75percent = moment(moment(scheduledstart).add(diffrence75, 'seconds')).utc().toISOString();
										if (newTimeWith75percent) {
											scheduleSessionData.triggers.push({
												"event_id": "async-session-75percent-time",
												"time": newTimeWith75percent,
												"active": true
											})
										}
									}
								}
							}
						}
						try {
							//logs
							await addLogToAws({ 
								category:'info', 
								method:'editExperience', 
								message:`Edit experience ${session_id} trigger schedule if scheduledend NULL`, data:scheduleSessionData
							});
							await schedule_session(getFindCustomer.customer_id, getExperience.session_code, scheduleSessionData, req.headers.idtoken)
						} catch (error) {
							return { status: "false", messagecode: "", message: error.message, data: null };
						}
					}
				} else if (getExperience.session_status == "LIVE") {
					Object.assign(sessionObject, {
						scheduled_end_at: (!!scheduledend ? moment(scheduledend).utc().toISOString() : null)
					})
					let scheduleSessionData = {
						"tenant_id": getFindCustomer.customer_id,
						"session_code": getExperience.session_code,
						"triggers": [
							{
								"event_id": "session-end",
								"time": moment(moment(scheduledend).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
								"active": true
							}
						],
						"entry_time": moment().unix()
					}
					if (getExperience.session_type == "ASYNC") {
						// add trigger for 75 percent time
						if (getExperience.scheduled_start_at && scheduledend) {
							let diffrence = moment(scheduledend).unix() - Number(getExperience.scheduled_start_at)
							if (diffrence) {
								let diffrence75 = Math.floor((diffrence * 75) / 100)
								if (diffrence75) {
									let newTimeWith75percent = moment(moment(Number(getExperience.scheduled_start_at) * 1000).add(diffrence75, 'seconds')).utc().toISOString();
									if (newTimeWith75percent) {
										scheduleSessionData.triggers.push({
											"event_id": "async-session-75percent-time",
											"time": newTimeWith75percent,
											"active": true
										})
									}
								}
							}
						}
					}
					// for send email after 10 minutes
					let endTimePlus10Minutes = moment(moment(scheduledend).add(600 + stimulus_video_length, 'seconds')).utc().toISOString();
					if (endTimePlus10Minutes) {
						scheduleSessionData.triggers.push({
							"event_id": "session-complete-email-10mins",
							"time": endTimePlus10Minutes,
							"active": true
						})
					}
					try {
						//logs
						await addLogToAws({ 
							category:'info', 
							method:'editExperience', 
							message:`Edit experience ${session_id} experience LIVE`, data:scheduleSessionData
						});
						await schedule_session(getFindCustomer.customer_id, getExperience.session_code, scheduleSessionData, req.headers.idtoken)
					} catch (error) {
						return { status: "false", messagecode: "", message: error.message, data: null };
					}
				}

				console.log("scheduledend--->", scheduledend)
				//logs
				await addLogToAws({ 
					category:'info', 
					method:'editExperience', 
					message:`Edit experience ${session_id} UPDATE to DB`, data:sessionObject
				});
				await sessionRepository.update({ 'session_id': +session_id }, sessionObject); //update session

				let updateObj = {
					scheduled_start_at: moment(moment(scheduledstart).format('YYYY-MM-DD hh:mm a')).utc().toISOString(),
					updated_at: moment().utc().toISOString()
				}
				await customerSessionsRepository.update({ 'session_code': getExperience.session_code }, updateObj); //update customer_sessions


				//update agenda on edit
				if (getExperience.session_type == "MODERATED") {
					//find new updated dates of sessions
					let getNewUpdatedData = await sessionRepository.findOne({
						where: {
							session_id: getExperience.session_id
						}
					})
					//get all moderated event agenda
					let getMarkers = await sessionMarkerRepository.find({
						where: {
							session_id: session_id,
							marker_type: 1
						}
					})
					let agenda = getMarkers.map(z => z.marker_title)
					let startAt = !!getNewUpdatedData.started_at ? getNewUpdatedData.started_at : getNewUpdatedData.scheduled_start_at
					let startTime = moment.unix(parseInt(startAt)).utc().toISOString();
					let endTime = moment.unix(parseInt(getNewUpdatedData.scheduled_end_at)).utc().toISOString();
					let getDeffirence = moment(endTime).diff(moment(startTime), 'seconds') / agenda.length;

					let getDefaulAgenda = this.createDefaulAgenda(getDeffirence, startTime, user_id, getNewUpdatedData.session_id, agenda)

					//delete all old marker
					await sessionMarkerRepository.delete({
						session_id: +session_id,
						marker_type: 1
					})

					//logs
					await addLogToAws({ 
						category:'info', 
						method:'editExperience', 
						message:`Edit experience ${session_id} Agendas`, data:getDefaulAgenda
					});
					//add new marker
					await sessionMarkerRepository.save(getDefaulAgenda)
				}

				returnResult = { status: "true", messagecode: "experienceUpdated", message: "" }
			} else {
				returnResult = { status: "false", messagecode: "experienceNotFound", message: "" }
			}
			return returnResult;
		} catch (error) {
			console.log(error)
			returnResult = { status: "false", messagecode: "", message: error.message };
			return returnResult;
			// throw new Error(returnResult);
		}
	}


	/**
	 * Get list of all experiences
	 * @param {*} {req}
	 * @param {number} keyword
	 * @param {[number]} userIds
	 * @returns {searchExperience}
	 */
	@Query(() => searchExperience)
	async search(@Ctx() { req },
		@Arg("keyword", { nullable: true }) keyword: string,
		@Arg('user_id', type => [Number], { nullable: true }) userIds: [number],
		@Arg("sort_direction", { nullable: true }) orderBy: string,
		@Arg("sort_column", { nullable: true }) orderColumn: string,
		@Arg("page_no") pageNo: number,
		@Arg("size") size: number,
		@Arg("identifier") identifier: string,
	) {
		try {
			let userId: any = userIds;
			if (userId === undefined) {
				userId = [];
			}

			let schema = req.headers.schemaname ? req.headers.schemaname : req.body.schemaname
			const publicConnection = await connection("public");
			const tenantConnection = await connection(schema);
			const customersRepository = publicConnection.getRepository(Customers);
			const customersDepartRepository = publicConnection.getRepository(CustomerDepartments);
			const sessionsRepository = tenantConnection.getRepository(Sessions);
			const sessionParticipantRepository = tenantConnection.getRepository(SessionParticipants);
			const userRepository = tenantConnection.getRepository(Users);
			let getCustomerData = await customersRepository.findOne({ where: { customer_name: schema } });
			let response = new searchExperience();
			response.show_user_column = userId && userId.length > 0 ? true : false
			//get user id
			let userDetails = await userRepository.findOne({
				username: req.body.email
			})

			let requestBody: any = {
				tenant_id: getCustomerData.customer_id,
				across_tenant: false
			}

			if (!!keyword.trim()) {
				Object.assign(requestBody, {
					search_fields: ["session_title", "project_name", "project_description", "stimulus_title"],
					search_keyword: keyword.trim()
				})

				if (userDetails.system_flagged != true) {
					if (userIds.length > 0) {
						Object.assign(requestBody, {
							owner_user_ids: userIds,
						})
					} else if (!!userDetails.department_id) {
						console.log("userDetails.department_id---->", userDetails.department_id)
						let departmentData = await customersDepartRepository.findOne({
							where: {
								department_id: userDetails.department_id
							}
						})
						if (departmentData.sharing) {
							console.log("departmentData.sharing--->", departmentData.sharing);
							let allCreatorData = await userRepository.createQueryBuilder("users")
								.select("users.user_id", "user_id")
								.leftJoin("users.roles", "roles")
								.leftJoin("roles.accesspages", "accesspages")
								.where("accesspages.access_name IN (:...access)", { access: ["experience_builder", "trial_builder"] })
								.andWhere("accesspages.access_value = :accessvalue", { accessvalue: true })
								.andWhere("users.department_id = :department_id", { department_id: departmentData.department_id })
								.getRawMany();
							let allCreator = allCreatorData.map(x => x.user_id)
							if (allCreator.length > 0) {
								response.show_user_column = true
							}
							Object.assign(requestBody, {
								owner_user_ids: allCreator,
							})
						} else {
							console.log("departmentData.sharing--->", departmentData.sharing)
							Object.assign(requestBody, {
								owner_user_ids: [userDetails.user_id],
							})
						}
					} else {
						Object.assign(requestBody, {
							owner_user_ids: [userDetails.user_id],
						})
					}
				} else {
					response.show_user_column = true
					if (userIds.length > 0) {
						Object.assign(requestBody, {
							owner_user_ids: userIds,
						})
					}
				}
			} else {
				Object.assign(requestBody, {
					search_entity: "session",
					page_no: 1,
					size: 1000,
					owner_user_ids: userId,
				})
			}

			//apply sorting on search request
			if (!!orderBy) {
				requestBody = {
					...requestBody,
					sort_direction: orderBy,
					sort_column: orderColumn
				}
			}

			logger.info("Here is search request--->", requestBody);

			let getSessionData: any = await search(getCustomerData.customer_id, requestBody, req.headers.idtoken);
			logger.info("without filter--->", getSessionData);
			if (getSessionData.record_count > 0) {
				let searchRecords = getSessionData.items;
				searchRecords = searchRecords.slice((pageNo - 1) * size, pageNo * size);
				let sessionFilteredData = []
				let getExperieneDetails = searchRecords.map(async (value, index) => {
					return new Promise(async (resolve) => {

						//find session data
						let experiecesData = await sessionsRepository.findOne({
							where: {
								session_id: value.session_id
							},
							relations: ['user']
						})
						if (!!experiecesData) {
							value.user = experiecesData.user
							//get participant counts
							let getCount = await sessionParticipantRepository.count({
								where: {
									session_id: value.session_id,
									participant_status: In(["COMPLETED","LIVE"]),
								}
							})
							value.started_at = moment(value.started_at).unix();
							value.scheduled_end_at = moment(value.scheduled_end_at).unix();
							value.scheduled_start_at = moment(value.scheduled_start_at).unix();
							value.completed_at = moment(value.completed_at).unix();
							value.ended_at = moment(value.ended_at).unix();
							value.created_at = moment(value.created_at).unix();
							value.updated_at = moment(value.updated_at).unix();

							value.participantscount = getCount
							value.safety_index = value.safety_index
							value.stimulus_clips = value.stimulus_clips
							value.small_thumbnail = experiecesData.small_thumbnail
							value.large_thumbnail = experiecesData.large_thumbnail

							let stimulusDetailsData = await stimulusDetails(experiecesData.customer_id, experiecesData.session_code, req.headers.idtoken);
							if (!!stimulusDetailsData[0]) {
								value.stimulus_type = stimulusDetailsData[0].stimulus_type == 'AUDIO' ? 'AUDIO' : null;
								value.stimulus_status = stimulusDetailsData[0].stimulus_status ? stimulusDetailsData[0].stimulus_status : null
							}

							sessionFilteredData.push(value)

							resolve(value)
						} else {
							resolve({})
						}
					})
				})
				let getAllSessionData:any = await Promise.all(getExperieneDetails)
				let filterData = getAllSessionData.filter((x) => {
					if (Object.keys(x).length > 0)
						return x
				})
				let projectData = searchRecords.filter(x => x.type == 'project')

				const filterProjectData = projectData.map((
					{
						project_name: projectName,
						project_id: projectId,
						project_owner_id: projectOwnerId,
						cascaded_project_id: cascadedProjectId,
						created_at: createdAt,
						updated_at: updatedAt
					}) => (
						{
							projectName,
							projectId,
							projectOwnerId,
							cascadedProjectId,
							createdAt,
							updatedAt
						})
				);
				response.count = getSessionData.record_count;
				if(identifier == "session" || pageNo == 1){
					response.sessions = filterData;
				}else{
					response.sessions = [];
				}
				
				response.projects = filterProjectData;
				//assign all clips to response
				console.log("getSessionData.clips----->",getSessionData.clips)
				response.clips_count = 0;
				let clipsFinalArray = []
				if(!!getSessionData.clips){
					if(getSessionData.clips.length > 0){						
						let clipsList = getSessionData.clips;
						/* logger.info("clipsList--->", clipsList);
						let newClipsList = clipsList.sort((a, b) => parseInt(b.session_id) - parseInt(a.session_id));
						logger.info("newClipsList--->", newClipsList); */
						let getExperieneClipDetails = clipsList.map(async (value) => {
							return new Promise(async (resolve) => {
								//find session data
								let experiecesData = await sessionsRepository.findOne({
									where: {
										session_id: value.session_id
									}
								})
								if (!!experiecesData) {
									//get participant counts
									let getCount = await sessionParticipantRepository.count({
										where: {
											session_id: value.session_id,
										}
									})

									value.participantscount = getCount
									value.small_thumbnail = experiecesData.small_thumbnail
									value.large_thumbnail = experiecesData.large_thumbnail
								}
								value.started_at = moment(value.started_at).unix();
								value.scheduled_end_at = moment(value.scheduled_end_at).unix();
								value.scheduled_start_at = moment(value.scheduled_start_at).unix();
								value.completed_at = moment(value.completed_at).unix();
								value.ended_at = moment(value.ended_at).unix();
								value.created_at = moment(value.created_at).unix();
								value.updated_at = moment(value.updated_at).unix();
								if(value.stimulus_clips && value.stimulus_clips.length > 0){
									/* logger.info("value.session_id--->", value.session_id);
									logger.info("value.stimulus_clips--->", value.stimulus_clips);
									let stimulusClipsList = value.stimulus_clips.sort(function(a, b) {
										var textA = a.title.toUpperCase();
										var textB = b.title.toUpperCase();
										return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
									})
									logger.info("stimulusClipsList--->", stimulusClipsList); */
									value.stimulus_clips.map(async (val) => {
										return new Promise(async (resolve1) => {
											Object.assign(val,{
												session_id:value.session_id,
												session_status:value.session_status,
												session_title:value.session_title,
												session_type:value.session_type,
												session_code:value.session_code
											})
											clipsFinalArray.push(val)
											resolve1(val)
										})
									})
								}
								resolve(value)
							})
						})
						await Promise.all(getExperieneClipDetails)
						logger.info("clipsFinalArray--->", clipsFinalArray);
						response.clips_count=clipsFinalArray.length
						//clipsFinalArray = clipsFinalArray.slice((pageNo - 1) * size, pageNo * size);
						if(identifier == "clips" || pageNo == 1){
							response.clips = clipsFinalArray;
						}else{
							response.clips = [];
						}
					}else{
						response.clips = [];
					}
				}else{
					response.clips = [];
				}
				response.identifier = identifier;
				logger.info("Search Reponse",response)
				return response;
			} else {
				response.count = 0;
				response.sessions = [];
				response.projects = [];
				response.clips_count = 0;
				let clipsFinalArray = []
				//assign all clips to response
				if(!!getSessionData.clips){
					if(getSessionData.clips.length > 0){
						response.clips_count = getSessionData.clips.length
						let getExperieneClipDetails = getSessionData.clips.map(async (value) => {
							return new Promise(async (resolve) => {
								//find session data
								let experiecesData = await sessionsRepository.findOne({
									where: {
										session_id: value.session_id
									}
								})
								if (!!experiecesData) {
									//get participant counts
									let getCount = await sessionParticipantRepository.count({
										where: {
											session_id: value.session_id,
										}
									})

									value.participantscount = getCount
									value.small_thumbnail = experiecesData.small_thumbnail
									value.large_thumbnail = experiecesData.large_thumbnail
								}
								value.started_at = moment(value.started_at).unix();
								value.scheduled_end_at = moment(value.scheduled_end_at).unix();
								value.scheduled_start_at = moment(value.scheduled_start_at).unix();
								value.completed_at = moment(value.completed_at).unix();
								value.ended_at = moment(value.ended_at).unix();
								value.created_at = moment(value.created_at).unix();
								value.updated_at = moment(value.updated_at).unix();
								if(value.stimulus_clips && value.stimulus_clips.length > 0){
									value.stimulus_clips.map(async (val) => {
										return new Promise(async (resolve1) => {
											Object.assign(val,{
												session_id:value.session_id,
												session_status:value.session_status,
												session_title:value.session_title,
												session_type:value.session_type,
												session_code:value.session_code
											})
											clipsFinalArray.push(val)
											resolve1(val)
										})
									})
								}
								resolve(value)
							})
						})
						await Promise.all(getExperieneClipDetails)
						response.clips = clipsFinalArray;
                      	response.clips_count = clipsFinalArray.length;
					}else{
						response.clips = [];
					}
				}else{
					response.clips = [];
				}
				response.identifier = identifier;
				return response
			}
		} catch (error) {
			console.log("Getting error while search", error)
			throw new Error(error);
		}
	}
}
