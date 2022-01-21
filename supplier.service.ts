/*
* This is main logic file
* Here code of product import by csv of supplier and save products into database
* This is next js freamwork
*/

import { Injectable, HttpService, HttpException, HttpStatus, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as moment from "moment";
import axios from 'axios';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from "typeorm";
import * as config from 'config';
import * as AWS from 'aws-sdk';
import xlsx from 'node-xlsx';
import { xml2json } from 'xml-js';
var request = require('request');
import { AWSConfig, EndPoint } from '../../../config/config.interfaces';
import { SupplierDto } from '../../dtos/supplier.dto';
import { SearchProductDto } from '../../dtos/searchproduct.dto';
import { SaveImportSettingDto } from '../../dtos/saveimportsetting.dto';
import { AmrodCategory, ImportSetting, ProductBin, ProductCategory, ProductImage, ProductInventory, ProductKeyword, ProductMaster, ProductOption, ProductPrice, ProductSite, ProductStore, SupplierMaster, UserProductFile, ProductCopyLog, ProductCopyLogDetail, ProductBackup, FashionbizProductCode, ProductDecoration, ProductDecorationCharge, AmrodProductDetail } from "../../entities/index.entity";
import { MessageResponseDto } from "../../dtos/messageresponse.dto";
import { SupplierUpdateResponseDto } from "../../dtos/supplierupdateresponse.dto";
import { FileStatusDto } from "../../dtos/filestatus.dto";
import { GetInventoryDto } from "../../dtos/getinventory.dto";
import { KevroService } from "../kevro/kevro.service";

const awsConfig: AWSConfig = config.get('aws');
const endPoint: EndPoint = config.get('endPoint');

const S3 = new AWS.S3({
    accessKeyId: awsConfig.accesskey,
    secretAccessKey: awsConfig.secretkey
});
const s3BucketName = awsConfig.bucket;

@Injectable()
export class SupplierService {
    constructor(
        private httpService: HttpService,
        private kevroService: KevroService,
        @InjectEntityManager('default') private writeManager: EntityManager,
        @InjectEntityManager('readdb') private readManager: EntityManager,

    ){}

    async getProductList(fileId:number): Promise<ProductMaster[]>{
        try{
            let productList = [];
            if(fileId){
                productList = await this.readManager.find(ProductMaster,{
                    where:{'file_id':fileId}
                });
            }else{
                productList = await this.readManager.find(ProductMaster);
            }

            for(let i=0; i<productList.length; i++){
                productList[i].imagedetail = await this.readManager.find(ProductImage,{'product_id':productList[i].id});
                productList[i].pricedetail = await this.readManager.find(ProductPrice,{'product_id':productList[i].id});
                productList[i].optiondetail = await this.readManager.find(ProductOption,{'product_id':productList[i].id});
                productList[i].categorydetail = await this.readManager.find(ProductCategory,{'product_id':productList[i].id});
                productList[i].bindetail = await this.readManager.find(ProductBin,{'product_id':productList[i].id});
                productList[i].inventorydetail = await this.readManager.find(ProductInventory,{'product_id':productList[i].id});
                productList[i].keyworddetail = await this.readManager.find(ProductKeyword,{'product_id':productList[i].id});
                productList[i].sitedetail = await this.readManager.find(ProductSite,{'product_id':productList[i].id});
                productList[i].storedetail = await this.readManager.find(ProductStore,{'product_id':productList[i].id});
            }
            return productList;
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async saveProduct(productData){
        try{
            
            if(productData.map_field.length > 0){
                if(productData.setting_name != "" && productData.setting_name != null){
                    let settingInput = {
                        'supplier_id': productData.supplier_id,
                        'setting_name': productData.setting_name,
                        'field_to_check': productData.field_to_check,
                        'map_fields': productData.map_field,
                        'created_date':moment().format('YYYY-MM-DD HH:mm:ss')
                    }  
                    let isSetting = await this.readManager.findOne(ImportSetting,{'setting_name': productData.setting_name});  
                    if(isSetting){
                        await this.writeManager.update(ImportSetting,{'id':isSetting.id},settingInput);
                    }else{
                        let saveData = await this.writeManager.create(ImportSetting,settingInput);
                        await this.writeManager.save(saveData);
                    }
                }
                
                let fileDetail = await this.readManager.findOne(UserProductFile,{'file_key':productData.file_key});
                
                if(fileDetail.status_id == 1){
                    if(fileDetail){
                        S3.getObject({ Bucket: s3BucketName, Key:fileDetail.file_key}).promise().then(async response => {
                            if(response.Body){                            
                                let buffers = [];
                                buffers.push(response.Body);
                                let buffer = Buffer.concat(buffers);
                                let workbook = xlsx.parse(buffer);
                                
                                await this.readManager.update(UserProductFile,{'id':fileDetail.id},{'status_id':2,'status_name':'Running'});
                                
                                this.saveProductDetail(workbook,productData.map_field,productData.field_to_check,fileDetail);
                                
                            }else{
                                throw new NotFoundException(`File detail not available`); 
                            }    
                        });
                        
                        return {'status': true, 'message':"File upload successfully"};
                    }else{
                        throw new NotFoundException(`File detail not available`);    
                    }
                }
            }else{
                throw new NotFoundException(`Map field is required`);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async saveProductDetail(productData,mapField,fieldToCheck:[string],fileDetail:UserProductFile){      
        
        let optFieldArr = ["part_id","inventory_key","min","max","color","hex","size","color_alias"];
        let categoryFieldArr = ["category_name"];
        let keywordFieldArr = ["keyword"];
        let storeFieldArr = ["store_name"];
        let imgFieldArr = ["image_id","image_url"];
        let invtFieldArr = ["inventory"];
        let siteFieldArr = ["site"];
        let binFieldArr = ["bin"];
        let priceFieldArr = ["quantity","price","saleprice"];
    
        let updData = {
            'status_id':4,
            'status_name':'Error',
            'message':[],
            'total_product':0,
            'success_product':0,
            'fail_product':0,
            'duplicate_product':0,
            'duplicate_record':[],
            'success_record':[],
            'fail_record':[],
        }
        let successProduct = 0;
        let failProduct = 0;
        let totalProduct = 0;
        let duplicate = 0;
        let errorMess = [];
        let rawNo = 0;
        let isCreate = false;
    
        let duplicateArr = [];
        let successArr = [];
        let failArr = [];
        let backupData = [];
        
        try{
            if(productData.length > 0){
                if(productData[0] && productData[0].data && productData[0].data.length > 0){
                    let duplicateVal = [];
                    let duplicateValArr = [];

                    for(let i=1; i<productData[0].data.length; i++){
                        rawNo += 1;
                        isCreate = false;

                        let detail = productData[0].data[i];
                        if(detail.length > 0){
                        
                            let productInput = {
                                'file_id': fileDetail.id
                            };
                            let partId = "";
                            let optionInput = {};
                            let categoryInput = {};
                            let storeInput = {};            
                            let inventoryInput = {};
                            let siteInput = {};
                            let binInput = {};
                            let imageInput = {};
                            let keywordInput = {};
                            let priceInput = {};
                            
                            let categoryInpArr = [];
                            let keywordInpArr = [];
                            let storeInpArr = [];
                            let optInpArr = [];
                            let priceInpArr = [];
                            let imgInpArr = [];
                            let invtInpArr = [];
                            let siteInpArr = [];
                            let binInpArr = [];
                            let saveProDetail: ProductMaster;
                            let rawDuplicateVal = [];
                                                        
                            for(let j=0; j<mapField.length; j++){
                                if(mapField[j].db_key && mapField[j].db_key != ""){
                                    let fieldNameArr = mapField[j].db_key.split('-');
                                    
                                    let keyIndex = 0;
    
                                    let fieldName = "";
                                    if(fieldNameArr.length > 1){
                                        fieldName = fieldNameArr[0];
                                        keyIndex = fieldNameArr[1];
                                    }else{
                                        fieldName = fieldNameArr[0];
                                    }
    
                                    let fieldValue = detail[j];
                                    
                                    if(!detail[j] || detail[j] == ""){
                                        fieldValue = mapField[j].default_value;
                                    }
                                    
                                    if(fieldValue != undefined && detail[j] != undefined){
                                        let isCheck = fieldToCheck.includes(fieldName);
                                        if(isCheck){
                                            if(duplicateVal.length != fieldToCheck.length){
                                                duplicateVal.push(fieldValue);
                                            }else{
                                                rawDuplicateVal.push(fieldValue);
                                            }
                                        }
    
                                        if(optFieldArr.indexOf(fieldName) > -1){
                                            if(optInpArr.length == 0){
                                                if(fieldName == "part_id"){
                                                    partId = fieldValue;
                                                }
                                                optionInput[fieldName] = fieldValue;
                                                optInpArr.push(optionInput);
                                            }else{
                                                let notAdd = true;
                                                if(optInpArr[keyIndex] && !optInpArr[keyIndex][fieldName]){
                                                    optInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    optionInput = {};
                                                    optionInput[fieldName] = fieldValue;
                                                    optInpArr.push(optionInput);
                                                }
                                            }
                                        }else if(categoryFieldArr.indexOf(fieldName) > -1){
                                            if(categoryInpArr.length == 0){
                                                categoryInput[fieldName] = fieldValue;
                                                categoryInpArr.push(categoryInput);
                                            }else{
                                                let notAdd = true;
                                                if(categoryInpArr[keyIndex] && !categoryInpArr[keyIndex][fieldName]){
                                                    categoryInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }                                    
                                                if(notAdd){
                                                    categoryInput = {};
                                                    categoryInput[fieldName] = fieldValue;
                                                    categoryInpArr.push(categoryInput);
                                                }
                                            }
                                        }else if(keywordFieldArr.indexOf(fieldName) > -1){
                                            if(keywordInpArr.length == 0){
                                                keywordInput[fieldName] = fieldValue;
                                                keywordInpArr.push(keywordInput);
                                            }else{
                                                let notAdd = true;
                                                if(keywordInpArr[keyIndex] && !keywordInpArr[keyIndex][fieldName]){
                                                    keywordInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    keywordInput = {};
                                                    keywordInput[fieldName] = fieldValue;
                                                    keywordInpArr.push(keywordInput);
                                                }
                                            }
                                        }else if(storeFieldArr.indexOf(fieldName) > -1){
                                            if(storeInpArr.length == 0){
                                                storeInput[fieldName] = fieldValue;
                                                storeInpArr.push(storeInput);
                                            }else{
                                                let notAdd = true;
                                                if(storeInpArr[keyIndex] && !storeInpArr[keyIndex][fieldName]){
                                                    storeInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    storeInput = {};
                                                    storeInput[fieldName] = fieldValue;
                                                    storeInpArr.push(storeInput);
                                                }
                                            }
                                            
                                        }else if(imgFieldArr.indexOf(fieldName) > -1){
                                            if(imgInpArr.length == 0){
                                                imageInput[fieldName] = fieldValue;
                                                imgInpArr.push(imageInput);
                                            }else{
                                                let notAdd = true;                                        
                                                if(imgInpArr[keyIndex] && !imgInpArr[keyIndex][fieldName]){
                                                    imgInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    imageInput = {};
                                                    imageInput[fieldName] = fieldValue;
                                                    imgInpArr.push(imageInput);
                                                }
                                            }
                                        }else if(invtFieldArr.indexOf(fieldName) > -1){
                                            if(invtInpArr.length == 0){
                                                inventoryInput[fieldName] = fieldValue;
                                                invtInpArr.push(inventoryInput);
                                            }else{
                                                let notAdd = true;                                        
                                                if(invtInpArr[keyIndex] && !invtInpArr[keyIndex][fieldName]){
                                                    invtInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    inventoryInput = {};
                                                    inventoryInput[fieldName] = fieldValue;
                                                    invtInpArr.push(inventoryInput);
                                                }
                                            }
                                        }else if(siteFieldArr.indexOf(fieldName) > -1){
                                            if(siteInpArr.length == 0){
                                                siteInput[fieldName] = fieldValue;
                                                siteInpArr.push(siteInput);
                                            }else{
                                                let notAdd = true;                                        
                                                if(siteInpArr[keyIndex] && !siteInpArr[keyIndex][fieldName]){
                                                    siteInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    siteInput = {};
                                                    siteInput[fieldName] = fieldValue;
                                                    siteInpArr.push(siteInput);
                                                }
                                            }    
                                        }else if(binFieldArr.indexOf(fieldName) > -1){
                                            if(binInpArr.length == 0){
                                                binInput[fieldName] = fieldValue;
                                                binInpArr.push(binInput);
                                            }else{
                                                let notAdd = true;                                        
                                                if(binInpArr[keyIndex] && !binInpArr[keyIndex][fieldName]){
                                                    binInpArr[keyIndex][fieldName] = fieldValue;
                                                    notAdd = false;
                                                }
                                                if(notAdd){
                                                    binInput = {};
                                                    binInput[fieldName] = fieldValue;
                                                    binInpArr.push(binInput);
                                                }
                                            }    
                                        }else if(priceFieldArr.indexOf(fieldName) > -1){
                                            if(fieldValue != null && fieldValue != ""){
                                                if(priceInpArr.length == 0){
                                                    priceInput[fieldName] = fieldValue;
                                                    priceInpArr.push(priceInput);
                                                }else{
                                                    let notAdd = true;
                                                    if(priceInpArr[keyIndex] && !priceInpArr[keyIndex][fieldName]){
                                                        priceInpArr[keyIndex][fieldName] = fieldValue;
                                                        notAdd = false;
                                                    }                                    
                                                    if(notAdd){
                                                        priceInput = {};
                                                        priceInput[fieldName] = fieldValue;
                                                        priceInpArr.push(priceInput);
                                                    }
                                                }
                                            }
                                        }else{
                                            productInput[fieldName] = fieldValue;
                                        }
                                    }
                                }                
                            }
                            let isDuplicate = false;
                            if(duplicateValArr.length != 0){
                                for(let e=0; e<duplicateValArr.length; e++){
                                    duplicateVal = duplicateValArr[e];
                                    
                                    let diff = duplicateVal.filter(element => rawDuplicateVal.includes(element));
                                    if(duplicateVal.length != 0 && duplicateVal.length == diff.length){
                                        duplicate += 1; 
                                        isDuplicate = true;
                                        duplicateArr.push(rawNo);
                                        duplicateValArr.push(duplicateVal);
                                        break;  
                                    }else{
                                        if(rawDuplicateVal.length > 0){
                                            duplicateVal = rawDuplicateVal;
                                        }
                                    }
                                }
                            }else{
                                duplicateValArr.push(duplicateVal);
                            }
                                
                            if(!isDuplicate){
                                duplicateValArr.push(duplicateVal);
                                if(productInput['item_no'] && productInput['name'] && productInput['vendor_name']){
                                    productInput['is_move'] = false;
                                    let proWhere = {
                                        'item_no':productInput['item_no'],
                                        'vendor_name':productInput['vendor_name']
                                    }
                                    let isExist = await this.readManager.findOne(ProductMaster,proWhere);
                                    if(isExist){
                                        if(optInpArr.length > 0){
                                            let optInpt = optInpArr[0];
                                            let optExist = await this.readManager.findOne(ProductOption,{
                                                'color': optInpt['color'],
                                                'size': optInpt['size'],
                                                'product_id': isExist.id,
                                            });
                                            if(optExist){
                                                if(fileDetail.import_type == 0){
                                                    await this.createProductBackup(isExist.id, backupData);
                                                    await this.writeManager.update(ProductMaster,{'id':isExist.id},productInput);
                                                    saveProDetail = await this.readManager.findOne(ProductMaster,{'id':isExist.id});
                                                    if(!isDuplicate){
                                                        successProduct += 1;
                                                        successArr.push(rawNo);
                                                    }
                                                }else{
                                                    failProduct += 1;
                                                    errorMess.push({'status':"error",'msg':"Row No:"+rawNo+" Product already exist, db id: "+isExist.id});
                                                    failArr.push(rawNo);
                                                }
                                            }else{
                                                saveProDetail = await this.readManager.findOne(ProductMaster,{'id':isExist.id});
                                            }
                                        }else{
                                            saveProDetail = await this.readManager.findOne(ProductMaster,{'id':isExist.id});
                                        }
                                    }else{
                                        let saveData = await this.writeManager.create(ProductMaster,productInput);
                                        saveProDetail = await this.writeManager.save(saveData);
                                        await this.createProductBackup(0, backupData);
                                        isCreate = true;
    
                                        successProduct += 1;
                                        successArr.push(rawNo);
                                    }
                                }else{
                                    errorMess.push({'status':"error",'msg':"Row No:"+rawNo+" Product name, item no, vendor name, colour, size is required"});
                                    failProduct += 1;
                                    failArr.push(rawNo);
                                }
                            }
                            totalProduct += 1;
                            
                            if(saveProDetail && saveProDetail.id){
                                for(let o=0; o<optInpArr.length; o++){
                                    let optInpt = optInpArr[o];
                                    optInpt['product_id'] = saveProDetail.id;
                                    
                                    let optExist = await this.readManager.findOne(ProductOption,optInpt);
                                    if(!optExist){                                        
                                        let saveOptData = await this.writeManager.create(ProductOption,optInpt);
                                        await this.writeManager.save(saveOptData);                                    
                                    }
                                }
    
                                for(let c=0; c<categoryInpArr.length; c++){
                                    let catInpt = categoryInpArr[c];
                                    catInpt['product_id'] = saveProDetail.id;

                                    let catgExist = await this.readManager.findOne(ProductCategory,catInpt);
                                    if(!catgExist){    
                                        let saveCtgData = await this.writeManager.create(ProductCategory,catInpt);
                                        await this.writeManager.save(saveCtgData);
                                    }
                                }
    
                                for(let k=0; k<keywordInpArr.length; k++){
                                    let keywordInpt = keywordInpArr[k];
                                    keywordInpt['product_id'] = saveProDetail.id;
                                    let keywordExist = await this.readManager.findOne(ProductKeyword,keywordInpt);
                                    if(!keywordExist){  
                                        let saveKeyData = await this.writeManager.create(ProductKeyword,keywordInpt);
                                        await this.writeManager.save(saveKeyData);
                                    }
                                }
    
                                for(let s=0; s<storeInpArr.length; s++){
                                    let storeInpt = storeInpArr[s];
                                    storeInpt['product_id'] = saveProDetail.id;
                                    let storeExist = await this.readManager.findOne(ProductStore,storeInpt);
                                    if(!storeExist){
                                        let saveStoreData = await this.writeManager.create(ProductStore,storeInpt);
                                        await this.writeManager.save(saveStoreData);
                                    }
                                }
                                for(let im=0; im<imgInpArr.length; im++){
                                    let imgInpt = imgInpArr[im]; 
                                    imgInpt['product_id'] = saveProDetail.id;
                                    if(partId != ""){
                                        imgInpt['part_id'] = partId;
                                    }                                    
                                    let saveImgData = await this.writeManager.create(ProductImage,imgInpt);
                                    await this.writeManager.save(saveImgData);
                                }
    
                                for(let it=0; it<invtInpArr.length; it++){
                                    let invtInpt = invtInpArr[it]; 
                                    invtInpt['product_id'] = saveProDetail.id;
                                    if(partId != ""){
                                        invtInpt['part_id'] = partId;
                                    }
                                    let invExist = await this.readManager.findOne(ProductInventory,invtInpt);
                                    if(!invExist){
                                        let saveInvtData = await this.writeManager.create(ProductInventory,invtInpt);
                                        await this.writeManager.save(saveInvtData);
                                    }
                                }
    
                                for(let si=0; si<siteInpArr.length; si++){
                                    let siteInpt = siteInpArr[si]; 
                                    siteInpt['product_id'] = saveProDetail.id;
                                    if(partId != ""){
                                        siteInpt['part_id'] = partId;
                                    }
                                    let siteExist = await this.readManager.findOne(ProductSite,siteInpt);
                                    if(!siteExist){
                                        let saveSiteData = await this.writeManager.create(ProductSite,siteInpt);
                                        await this.writeManager.save(saveSiteData);
                                    }
                                }
    
                                for(let b=0; b<binInpArr.length; b++){
                                    let binInpt = binInpArr[b]; 
                                    binInpt['product_id'] = saveProDetail.id;
                                    if(partId != ""){
                                        binInpt['part_id'] = partId;
                                    }
                                    let binExist = await this.readManager.findOne(ProductBin,binInpt);
                                    if(!binExist){
                                        let savebinData = await this.writeManager.create(ProductBin,binInpt);
                                        await this.writeManager.save(savebinData);
                                    }
                                }
    
                                for(let p=0; p<priceInpArr.length; p++){
                                    let priceInpt = priceInpArr[p]; 
                                    priceInpt['product_id'] = saveProDetail.id;
                                    if(partId != ""){
                                        priceInpt['part_id'] = partId;
                                    }
    
                                    let savePriceData = await this.writeManager.create(ProductPrice,priceInpt);
                                    await this.writeManager.save(savePriceData);
                                }
                            }
                        }else{
                            errorMess.push({'status':"error",'msg':"Row No:"+rawNo+" Product detail"});
                            failProduct += 1;
                            failArr.push(rawNo);
                        }
                    }
                    if(failProduct == 0){
                        updData.status_id = 3;
                        updData.status_name = "Complete";
                        errorMess.push({'status':"success",'msg':"All products push successfully"});
                    }else{
                        updData.status_id = 5;
                        updData.status_name = "Success with warnings";
                    }
    
                    let proBackup = {
                        'file_id': fileDetail.id,
                        'product_detail': backupData,
                        'is_undo': false,
                        'created_date': moment().format("YYYY-MM-DD")
                    }
                    let filebackExist = await this.readManager.findOne(ProductBackup,{'file_id': fileDetail.id});
                    if(!filebackExist){
                        let backupCreate = await this.writeManager.create(ProductBackup,proBackup);
                        await this.writeManager.save(backupCreate);
                    }else{
                        await this.writeManager.update(ProductBackup,{'id':filebackExist.id},proBackup);
                    }
                    
                    updData.message = errorMess;
                    updData.total_product = totalProduct;
                    updData.success_product = successProduct;
                    updData.fail_product = failProduct;
                    updData.duplicate_product = duplicate;
                    updData.duplicate_record = duplicateArr;
                    updData.success_record = successArr;
                    updData.fail_record = failArr;
                    
                    await this.writeManager.update(UserProductFile,{'id':fileDetail.id},updData);
    
                    return {
                        "status": true,
                        "message": "File import successfully",
                        'total_product': totalProduct,
                        'total_success_product': successProduct,
                        'success_record': successArr,
                        'total_duplicate_product': duplicate,
                        'duplicate_record': duplicateArr,
                        'total_fail_product': failProduct,
                        'fail_record': failArr,
                    }
                }else{
                    updData.message.push({'status':"error",'msg':"Invalid file format"});
                    await this.writeManager.update(UserProductFile,{'id':fileDetail.id},updData);
                    throw new HttpException("Invalid file format", HttpStatus.NOT_ACCEPTABLE);
                }
            }else{
                updData.message.push({'status':"error",'msg':"Invalid file format"});
                await this.writeManager.update(UserProductFile,{'id':fileDetail.id},updData);
                throw new HttpException("Invalid file format", HttpStatus.NOT_ACCEPTABLE);
            }
        }catch(error){
            errorMess.push({'status':"error",'msg':"Raw No:"+rawNo+" "+error});
    
            updData.message = errorMess;
            updData.total_product = totalProduct;
            updData.success_product = successProduct;
            updData.success_record = successArr;
            updData.duplicate_product = duplicate;
            updData.duplicate_record = duplicateArr;
            updData.fail_product = failProduct;
            updData.fail_record = failArr;
            await this.writeManager.update(UserProductFile,{'id':fileDetail.id},updData);
            throw new InternalServerErrorException(error); 
        }
    }

    async createRespObj(productData,detail){
        let colObj = {};
        for(let d=0; d<productData[0].data[0].length; d++){
            if(productData[0].data[0][d] && productData[0].data[0][d] != null){
                let columnName = productData[0].data[0][d].toString().toLowerCase().replace( / +/g,"_");
                if(detail[d]){
                    colObj[columnName] = detail[d];
                }else{
                    colObj[columnName] = "";
                }
            }
        }
        return colObj;
    }

    async searchProduct(searchData:SearchProductDto): Promise<object[]>{
        try{
            let proList = [];
            if(searchData.term){
                let masterField = '';
                let masterFieldVal = {};
                let categoryField = "";
                let categoryFieldVal = {};
                let priceField = "";
                let priceFieldVal = {};

                if(searchData.term.name != ""){
                    if(masterField != ""){
                        masterField += ' AND name like :name';
                    }else{
                        masterField = 'name like :name';
                    }
                    masterFieldVal['name'] = '%' +searchData.term.name + '%' 
                }
                if(searchData.term.itemNo != ""){
                    if(masterField != ""){
                        masterField += ' AND item_no like :itemNo';
                    }else{
                        masterField = 'item_no like :itemNo';
                    }
                    masterFieldVal['itemNo'] = '%' +searchData.term.itemNo + '%' 
                }
                if(searchData.term.brand != ""){
                    if(masterField != ""){
                        masterField += ' AND brand like :brand';
                    }else{
                        masterField = 'brand like :brand';
                    }
                    masterFieldVal['brand'] = '%' +searchData.term.brand + '%' 
                }
                if(searchData.term.supplier_type.length > 0){
                    if(masterField != ""){
                        masterField += ' AND vendor_name IN(:...vendorName)';
                    }else{
                        masterField = 'vendor_name IN(:...vendorName)';
                    }
                    masterFieldVal['vendorName'] = searchData.term.supplier_type
                }
                if(searchData.term.category != ""){
                    categoryField = 'categorydetail.category_name like :categoryName';
                    categoryFieldVal['categoryName'] = '%' +searchData.term.category + '%' 
                }
                if(searchData.term.price != ""){
                    let priceArr = searchData.term.price.split('-');
                    priceField = 'pricedetail.saleprice BETWEEN :lowPrice AND :highPrice';
                    priceFieldVal['lowPrice'] = parseInt(priceArr[0]); 
                    priceFieldVal['highPrice'] = parseInt(priceArr[1]); 
                }

                let proSearchQ = this.readManager.getRepository(ProductMaster).createQueryBuilder('product_master');
                if(masterField != ""){
                    proSearchQ.where(masterField,masterFieldVal)
                }
                if(categoryField != ""){
                    proSearchQ.innerJoinAndSelect('product_master.categorydetail',"categorydetail",categoryField,categoryFieldVal)
                }
                if(priceField != ""){
                    proSearchQ.innerJoinAndSelect('product_master.pricedetail',"pricedetail",priceField,priceFieldVal)
                }
                proSearchQ.leftJoinAndSelect('product_master.imagedetail',"imagedetail")
                
                proList = await proSearchQ.getMany();                
            }
            let proListArr = [];
            for(let i=0; i<proList.length; i++){
                let proDetail = proList[i];
                let priceList = await this.readManager.find(ProductPrice,{'product_id':proDetail.id});
                let optionList = await this.readManager.find(ProductOption,{'product_id':proDetail.id});
                let imagedetail = await this.readManager.find(ProductImage,{'product_id':proDetail.id});
                let categorydetail = await this.readManager.find(ProductCategory,{'product_id':proDetail.id});
                let proPrice = "0";
                for(let p=0; p<priceList.length; p++){
                    let pricedetail = priceList[p];
                    if(pricedetail && optionList.length > 0){
                        if(pricedetail.saleprice && pricedetail.saleprice != '0' && pricedetail.saleprice != ''){
                            proPrice = pricedetail.saleprice; 
                        }else{
                            if(pricedetail.price != '0'){
                                proPrice = pricedetail.price; 
                            }
                        }
                        if(proPrice != '0'){
                            break;
                        }
                    }
                }

                let isMedia = 0;
                if(imagedetail.length > 0){
                    isMedia = 1;
                }

                let catgList = [];
                for(let c=0; c<categorydetail.length; c++){
                    let catgDetail = categorydetail[c];
                    catgList.push({'category':catgDetail.category_name});
                }

                let mediaList = [];
                for(let m=0; m<imagedetail.length; m++){
                    let mediaObj = {
                        'mediaType': "Image",
                        'partId': imagedetail[m].part_id,
                        'productId': proDetail.item_no,
                        'url': imagedetail[m].image_url,
                    }
                    mediaList.push(mediaObj);
                }

                let proObj = {
                    'api': "productImport",
                    "sourceId": proDetail.id,
                    "mediaContentAvail": isMedia,
                    'productId':proDetail.item_no,
                    'saleprice':proPrice,
                    'productName':proDetail.name,
                    'productBrand':"",
                    'vendor':proDetail.vendor_name,
                    'ProductCategoryArray':catgList,
                    'MediaContent':mediaList
                }
                proListArr.push(proObj);
            }
            return proListArr;
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async getMoveProductDetail(productId: [string]): Promise<object>{
        try{
            let proSearchQ = this.readManager.getRepository(ProductMaster).createQueryBuilder('product_master');
            proSearchQ.where('product_master.id IN (:...ids)',{'ids':productId})
            let productList = await proSearchQ.getMany();

            let newProList = [];
            for(let i=0; i<productList.length; i++){
                let proDetail = productList[i];
                if(proDetail){
                    let proDetailObj = await this.createProductObj(proDetail);
                    newProList.push(proDetailObj);
                }
            }
            if(newProList.length > 0){
                return {'status':true,'message':"product list",'data':newProList};
            }else{
                throw new HttpException("Product list not available", HttpStatus.NOT_FOUND);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async saveImportSetting(settingData: SaveImportSettingDto){
        try{
            let inputData = {
                'supplier_id': settingData.supplier_id,
                'setting_name': settingData.name,
                'field_to_check': settingData.field_to_check,
                'map_fields': settingData.map_field,
                'created_date':moment().format('YYYY-MM-DD HH:mm:ss')
            };
            
            let saveData = await this.writeManager.create(ImportSetting,inputData);
            let saveStatus = await this.writeManager.save(saveData);
            if(saveStatus){
                return {'status': true, 'message':"Import setting save successfully"};
            }else{
                throw new NotFoundException(`Setting not save`);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async getImportSettingList(supplierId): Promise<ImportSetting[]>{
        try{
            let settingDetails = await this.readManager.find(ImportSetting,{'supplier_id':supplierId});
            let settingList = [];
            for(let i=0; i<settingDetails.length; i++){
                settingList.push({'key':settingDetails[i].id,'name':settingDetails[i].setting_name})
            }
            return settingList;
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async updateProductMoveStatus(productRes: object[]){
        try{
            if(productRes.length > 0){
                for(let i=0; i<productRes.length; i++){
                    let type = "";
                    let isExist = await this.readManager.findOne(ProductCopyLog,{'product_id':productRes[i]['source_id']});
                    if(isExist){
                        if(productRes[i]['is_created'] == '1'){
                            isExist.total_created += 1;
                        }
                        if(productRes[i]['is_updated'] == '1'){
                            isExist.total_updated += 1;
                        }
                        let inputData = {
                            'total_updated': isExist.total_updated,
                            'total_created': isExist.total_created,
                            'update_date': moment().format('YYYY-MM-DD HH:mm:ss')
                        }
                        await this.readManager.update(ProductCopyLog,{'product_id':productRes[i]['source_id']},inputData);
                        type = 'update';
                    }else{
                        let inputData = {
                            'product_id': productRes[i]['source_id'],
                            'item_no': productRes[i]['item_no'],
                            'total_updated': productRes[i]['is_updated'],
                            'total_created': productRes[i]['is_created'],
                            'created_date': moment().format('YYYY-MM-DD HH:mm:ss')
                        }
                        let saveData = await this.readManager.create(ProductCopyLog,inputData);
                        await this.readManager.save(ProductCopyLog,saveData);
                        type = 'create';
                    }

                    let logInput = {
                        'product_id': productRes[i]['source_id'],
                        'backend_product_id': productRes[i]['result'],
                        'backend_user_id': productRes[i]['user_id'],
                        'item_no': productRes[i]['item_no'],
                        'date': moment().format('YYYY-MM-DD HH:mm:ss'),
                        'type': type,
                        'product_detail': productRes[i]['diff']
                    };
                    let logCreate = await this.writeManager.create(ProductCopyLogDetail,logInput);
                    await this.writeManager.save(logCreate);
                }
            }else{
                throw new HttpException("Product list is required", HttpStatus.NOT_ACCEPTABLE);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async createProductBackup(productId:number, backupData:object[]): Promise<object>{
        try{
            if(productId != 0){
                let proDetail = await this.readManager.findOne(ProductMaster,{'id':productId});
                let proOptList = await this.readManager.find(ProductOption,{'product_id':productId});
                let proCtgList = await this.readManager.find(ProductCategory,{'product_id':productId});
                let proKeyList = await this.readManager.find(ProductKeyword,{'product_id':productId});
                let proStoreList = await this.readManager.find(ProductStore,{'product_id':productId});
                let proImgList = await this.readManager.find(ProductImage,{'product_id':productId});
                let proInvList = await this.readManager.find(ProductInventory,{'product_id':productId});
                let proSiteList = await this.readManager.find(ProductSite,{'product_id':productId});
                let proBinList = await this.readManager.find(ProductBin,{'product_id':productId});
                let proPriceList = await this.readManager.find(ProductPrice,{'product_id':productId});
                
                let tableData = {'table_name':'product_master','fields':[]};
                let fieldArr = [];
                for (const [key, value] of Object.entries(proDetail)) {
                    if(key != "id"){
                        let fieldObj = {
                            'pkey': proDetail.id,
                            'field_name': key,
                            'old_vale': value,
                        }
                        fieldArr.push(fieldObj);
                    }
                }
                tableData.fields = fieldArr;
                backupData.push(tableData);

                if(proOptList.length > 0){
                    tableData = {'table_name':'product_option','fields':[]};
                    fieldArr = [];
                    for(let o=0; o<proOptList.length; o++){
                        let optDetail = proOptList[o]
                        for (const [key, value] of Object.entries(optDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': optDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proCtgList.length > 0){
                    tableData = {'table_name':'product_category','fields':[]};
                    fieldArr = [];
                    for(let c=0; c<proCtgList.length; c++){
                        let ctgDetail = proCtgList[c]
                        for (const [key, value] of Object.entries(ctgDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': ctgDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proKeyList.length > 0){
                    tableData = {'table_name':'product_keyword','fields':[]};
                    fieldArr = [];
                    for(let k=0; k<proKeyList.length; k++){
                        let keyDetail = proKeyList[k]
                        for (const [key, value] of Object.entries(keyDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': keyDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proStoreList.length > 0){
                    tableData = {'table_name':'product_store','fields':[]};
                    fieldArr = [];
                    for(let p=0; p<proStoreList.length; p++){
                        let storeDetail = proStoreList[p]
                        for (const [key, value] of Object.entries(storeDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': storeDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proImgList.length > 0){
                    tableData = {'table_name':'product_image','fields':[]};
                    fieldArr = [];
                    for(let i=0; i<proImgList.length; i++){
                        let imgDetail = proImgList[i]
                        for (const [key, value] of Object.entries(imgDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': imgDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proInvList.length > 0){
                    tableData = {'table_name':'product_inventory','fields':[]};
                    fieldArr = [];
                    for(let n=0; n<proInvList.length; n++){
                        let invDetail = proInvList[n]
                        for (const [key, value] of Object.entries(invDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': invDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proSiteList.length > 0){
                    tableData = {'table_name':'product_site','fields':[]};
                    fieldArr = [];
                    for(let s=0; s<proSiteList.length; s++){
                        let siteDetail = proSiteList[s]
                        for (const [key, value] of Object.entries(siteDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': siteDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proBinList.length > 0){
                    tableData = {'table_name':'product_bin','fields':[]};
                    fieldArr = [];
                    for(let b=0; b<proBinList.length; b++){
                        let binDetail = proBinList[b]
                        for (const [key, value] of Object.entries(binDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': binDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }

                if(proPriceList.length > 0){
                    tableData = {'table_name':'product_price','fields':[]};
                    fieldArr = [];
                    for(let p=0; p<proPriceList.length; p++){
                        let priceDetail = proPriceList[p]
                        for (const [key, value] of Object.entries(priceDetail)) {
                            if(key != "id"){
                                let fieldObj = {
                                    'pkey': priceDetail.id,
                                    'field_name': key,
                                    'old_vale': value,
                                }
                                fieldArr.push(fieldObj);
                            }
                        }
                    }
                    tableData.fields = fieldArr;
                    backupData.push(tableData);
                }
            }
            return {'status':true, 'message':"Product backup successfully", 'data':backupData}
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async productImportUndo(fileKey:string): Promise<MessageResponseDto>{
        try{
            let fileDetail = await this.readManager.findOne(UserProductFile,{'file_key':fileKey});
            let fileId = fileDetail.id;

            let backupDetail = await this.readManager.findOne(ProductBackup,{'file_id':fileId});
            if(backupDetail){
                if(!backupDetail.is_undo){
                    if(backupDetail.product_detail){
                        for(let i=0; i<backupDetail.product_detail.length; i++){
                            let tableDetail = backupDetail.product_detail[i];
                            
                            let tableName = await this.createTableName(tableDetail['table_name']);
                            for(let f=0; f<tableDetail['fields'].length; f++){
                                let filedDetail = tableDetail['fields'][f];

                                let isExist = await this.writeManager.create(tableName,{'id':filedDetail.pkey});
                                if(!isExist){
                                    let createData = await this.writeManager.create(tableName,{'id':filedDetail.pkey,[filedDetail.field_name]:filedDetail.old_vale});
                                    let created = await this.writeManager.save(createData);
                                }else{
                                    await this.writeManager.update(tableName,{'id':filedDetail.pkey},{[filedDetail.field_name]:filedDetail.old_vale});
                                }
                            }
                        }
                    }
                    
                    await this.writeManager.update(ProductBackup,{'id':backupDetail.id},{'is_undo':true});

                    let productList = await this.readManager.find(ProductMaster,{'file_id':fileId});
                    for(let p=0; p<productList.length; p++){
                        await this.writeManager.delete(ProductImage,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductPrice,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductOption,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductCategory,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductBin,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductInventory,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductKeyword,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductSite,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductStore,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductDecoration,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductDecorationCharge,{'product_id':productList[p].id});
                        await this.writeManager.delete(ProductMaster,{'id':productList[p].id});
                    }

                    return {'status': true, 'message':"Import undo successfully"}
                }else{
                    return {'status': true, 'message':"This import file already undo"}
                }
            }else{
                throw new HttpException("File detail not available", HttpStatus.NOT_ACCEPTABLE)
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async createTableName(tableName:string){
        let nameArr = tableName.split('_');
        for (var i = 0; i < nameArr.length; i++) {
            nameArr[i] = nameArr[i].charAt(0).toUpperCase() + nameArr[i].substring(1);     
        }
        return nameArr.join(''); 
    }

    async clearProduct(fileId:number): Promise<MessageResponseDto>{
        try{
            let productList = [];
            if(fileId == 0){
                productList = await this.readManager.find(ProductMaster,{});
                await this.writeManager.update(FashionbizProductCode,{},{'status':'1'});
            }else{
                productList = await this.readManager.find(ProductMaster,{'file_id':fileId});
            }
            for(let p=0; p<productList.length; p++){
                await this.deleteProductDetail(productList[p].id);
            }

            return {'status': true, 'message':"Product clear successfully"};
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async deleteImportSetting(settingId:number): Promise<MessageResponseDto>{
        try{
            await this.writeManager.delete(ImportSetting,{'id':settingId});
            return {'status': true, 'message':"Setting delete successfully"};
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async updateProductOpt(){
        let proList = await this.writeManager.find(ProductMaster,{'vendor_name': 'australianapi'});
        for(let p=0; p<proList.length; p++){
            let optList = await this.writeManager.find(ProductPrice,{'product_id':proList[p].id});
            for(let i=0; i<optList.length; i++){
                let qq = optList[i].quantity.split("-");
                let qty = parseInt(qq[0]);
                await this.writeManager.update(ProductPrice,{'id':optList[i].id},{'quantity':qty.toString()});
            }
        }
        return {'status': true, 'message':"Option update successfully"};
    }

    async getProductDetailByItemNo(products){
        try{
            let newProList = [];
            for(let i=0; i<products.length; i++){
                let proDetail = await this.readManager.findOne(ProductMaster,{'item_no':products[i].productId,'vendor_name':products[i].vendor});
                if(proDetail){
                    let proDetailObj = await this.createProductObj(proDetail);
                    newProList.push(proDetailObj);
                }
            }
            if(newProList.length > 0){
                return {'status':true,'message':"product list",'data':newProList};
            }else{
                throw new HttpException("Product list not available", HttpStatus.NOT_FOUND);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async createProductObj(proDetail){
        let projectObj = {};
        proDetail.imagedetail = await this.readManager.find(ProductImage,{'product_id':proDetail.id});
        proDetail.pricedetail = await this.readManager.find(ProductPrice,{'product_id':proDetail.id});
        proDetail.optiondetail = await this.readManager.find(ProductOption,{'product_id':proDetail.id});
        proDetail.categorydetail = await this.readManager.find(ProductCategory,{'product_id':proDetail.id});
        proDetail.bindetail = await this.readManager.find(ProductBin,{'product_id':proDetail.id});
        proDetail.inventorydetail = await this.readManager.find(ProductInventory,{'product_id':proDetail.id});
        proDetail.keyworddetail = await this.readManager.find(ProductKeyword,{'product_id':proDetail.id});
        proDetail.sitedetail = await this.readManager.find(ProductSite,{'product_id':proDetail.id});
        proDetail.storedetail = await this.readManager.find(ProductStore,{'product_id':proDetail.id});
        proDetail.productdecorationdetail = await this.readManager.find(ProductDecoration,{'product_id':proDetail.id});
        
        let catgList = [];
        for(let c=0; c<proDetail.categorydetail.length; c++){
            let catgDetail = proDetail.categorydetail[c];
            catgList.push({'category':catgDetail.category_name});
        }
        
        let partArr = [];
        let mediaContentList = [];
        if(proDetail.optiondetail.length > 0){
            let currentOptArr = [];
            for(let o=0; o<proDetail.optiondetail.length; o++){
                let optDetail = proDetail.optiondetail[o];                

                let invDetail = await this.readManager.findOne(ProductInventory,{'product_id':proDetail.id,'part_id':optDetail.part_id});
                let inventory = '0';
                if(invDetail){
                    inventory = invDetail.inventory
                }

                let size = (optDetail.size) ? optDetail.size : "OSFA";
                let apparelSize = {
                    'labelSize': size.trim(),
                    'label': size.trim(),
                    'rank': 0
                }
                currentOptArr.push(optDetail);
                let colorName = "";
                if(partArr.length > 0 && optDetail.color && optDetail.color != null && optDetail.color != ""){
                    colorName = optDetail.color.trim();
                }else{
                    if(partArr.length == 0){
                        colorName = (optDetail.color) ? optDetail.color : "No Color";
                    }else{
                        let sizeExist = currentOptArr.find(o => o.size === size && o.id != optDetail.id );
                        if(!sizeExist){
                            colorName = "No Color";
                        }
                    }
                }

                let colorArray = {
                    'Color':{
                        'colorName': colorName,
                        'hex': optDetail.hex
                    }
                }

                let partPriceList = await this.readManager.find(ProductPrice,{'product_id':proDetail.id,'part_id':optDetail.part_id});
                if(partPriceList.length == 0){
                    partPriceList = await this.readManager.find(ProductPrice,{'product_id':proDetail.id});
                }
                let priceArr = [];
                for(let p=0; p<partPriceList.length; p++){
                    let price = partPriceList[p].price;
                    if(price == ""){
                        price = proDetail.price
                    }

                    let salePrice = partPriceList[p].saleprice;
                    if(salePrice == ""){
                        salePrice = proDetail.special_price
                    }
                    let minQuantity = (partPriceList[p].quantity != "" && parseInt(partPriceList[p].quantity) != 0) ? parseInt(partPriceList[p].quantity) : 1;
                    
                    let priceExist = priceArr.find(o => o.minQuantity === minQuantity);
                    if(!priceExist){
                        priceArr.push({
                            'minQuantity': minQuantity,
                            'price': (price != "") ? price : 0,
                            'salePrice': (salePrice != "") ? salePrice : 0,
                            'margin': 0,
                            'unitProfit': 0,
                            'totalPrice': (price != "") ? price : 0,
                            'totalSalesPrice': (salePrice != "") ? salePrice : 0,
                            'totalProfit': 0,
                        });
                    }
                }
                
                let partPrice = {
                    "PartPriceArray":{
                        'PartPrice': priceArr,
                        'partId': optDetail.part_id
                    }
                }

                let partId = optDetail.color+"-"+optDetail.size;
                if((optDetail.size == null || optDetail.size == "") && (optDetail.color != null && optDetail.color != "")){
                    partId = optDetail.color.trim()+"-OSFA";
                }
                else if((optDetail.color == null || optDetail.color == "") && (optDetail.size != null && optDetail.size.trim() != "")){
                    partId = "No Color-"+optDetail.size.trim();
                }
                else if((optDetail.size == null || optDetail.size == "") && (optDetail.color == null || optDetail.color == "")){
                    partId = "No Color-OSFA";
                }

                let partObj = {
                    'ApparelSize': apparelSize,
                    'ColorArray': colorArray,
                    'active': true,
                    'inventory': inventory,
                    'inventoryKey': optDetail.inventory_key,
                    'max': optDetail.max,
                    'min': optDetail.min,
                    'partId': partId.trim(),
                    'priceType': "0",
                    'sku': optDetail.part_id,
                    'partPrice': partPrice,
                    'saleStartDate':"",
                    'saleEndDate':""
                }
                if(colorName != ""){
                    partArr.push(partObj);
                }

                let primary = false;
                if(o==0){
                    primary = true;
                }

                let imageUrl = "";
                if(optDetail.opt_image != "" && optDetail.opt_image != null){
                    imageUrl = optDetail.opt_image;
                }else if(proDetail.imagedetail[o] && proDetail.imagedetail[o].image_url && proDetail.imagedetail[o].image_url != null && proDetail.imagedetail[o].image_url != ""){
                    imageUrl = proDetail.imagedetail[o].image_url;
                }

                let mediaDetail = {
                    'color': colorName,
                    'displayGroup': "0",
                    'group': "0",
                    'groups': [],
                    'hex': optDetail.hex,
                    'hidden': false,
                    'index': 0,
                    'logoBlockCount': 0,
                    'mediaType': "Image",
                    'partId': optDetail.part_id,
                    'primary': primary,
                    'productId': proDetail.item_no,
                    'secondary': false,
                    'select': false,
                    'sku': "",
                    'url': imageUrl,
                }
                if(colorName != ""){
                    mediaContentList.push(mediaDetail);
                }
            }
        }else{
            for(let m=0; m<proDetail.imagedetail.length; m++){
                let mediaData = proDetail.imagedetail[m];
                let primary = false;
                if(m==0){
                    primary = true;
                }

                let mediaDetail = {
                    'color': "No Color ",
                    'displayGroup': "0",
                    'group': "0",
                    'groups': [],
                    'hex': '',
                    'hidden': false,
                    'index': 0,
                    'logoBlockCount': 0,
                    'mediaType': "Image",
                    'partId': mediaData.part_id,
                    'primary': primary,
                    'productId': proDetail.item_no,
                    'secondary': false,
                    'select': false,
                    'sku': "",
                    'url': mediaData.image_url,
                }
                mediaContentList.push(mediaDetail);
            }
        }
        let storeList = []
        for(let s=0; s<proDetail.storedetail.length; s++){
            storeList.push({'store':proDetail.storedetail[s].store_name});
        }

        let keywordList = [];
        for(let k=0; k<proDetail.keyworddetail.length; k++){
            keywordList.push({'keyword':proDetail.keyworddetail[k].keyword})
        }

        let proStatus = 1;
        if(proDetail.status == "inactive"){
            proStatus = 2;
        }
        if(proDetail.status == "pending approval"){
            proStatus = 3;
        }

        let expireDate = moment().format("YYYY-MM-DD");
        if(proDetail.expiration_date && proDetail.expiration_date != null){
            if(moment(proDetail.expiration_date, "YYYY-MM-DDTHH:mm:ss", true).isValid()){
                expireDate = moment(proDetail.expiration_date).format("YYYY-MM-DD");
            }
        }
        
        let proDescription = proDetail.name
        if(proDetail.description != null){
            if(typeof proDetail.description == "object"){
                if(proDetail.description['features']){
                    proDescription = proDetail.description['features'].join(" ");
                }
            }else{
                proDescription = proDetail.description;
            }
        }

        let decorationArr = [];
        let decorationNameArr = [];
        for(let d=0; d<proDetail.productdecorationdetail.length; d++){
            let decorationDetail = proDetail.productdecorationdetail[d];

            let decoChargeList = await this.readManager.find(ProductDecorationCharge,{'product_id':proDetail.id,'decoration_id':decorationDetail.id});
            
            let chargeArr = []
            if(decoChargeList.length > 0){
                let chargePriceArr = [];
                for(let c=0; c<decoChargeList.length; c++){
                    let chargeDetail = decoChargeList[c]
                    let chargePriceObj = {
                        'supplierChargePriceId':"",
                        'xMinQty':chargeDetail.minquantity,
                        'xUom':"EA",
                        'yMinQty':chargeDetail.minquantity,
                        'yUom':"Locations",
                        'price':chargeDetail.setup_cost,
                        'repeatPrice':"0",
                        'priceEffectiveDate':"",
                        'priceExpiryDate':"",
                    }
                    chargePriceArr.push(chargePriceObj);
                }
                let chargeObj = {
                    'supplierChargeId':"",
                    'chargeId':"",
                    'chargeName':"Setup Charge: "+decorationDetail.decoration_name,
                    'chargeType':"Setup",
                    'chargeDescription':"Setup Charge: "+decorationDetail.decoration_name,
                    'chargeAppliesLTM':"0",
                    'chargesPerLocation':"0",
                    'chargesPerColor':"0",
                    'ChargePriceArray':{'ChargePrice':chargePriceArr},
                }
                chargeArr.push(chargeObj);
            }

            decorationNameArr.push(decorationDetail.decoration_name);
            let decoObject = {
                'decorationId':"",
                'imprintPriceKey':"",
                'sourceId':"",
                'decorationName':decorationDetail.decoration_name,
                'decorationGeometry':"",
                'decorationHeight':"",
                'decorationWidth':"",
                'decorationUom':"",
                'decorationUnitsMax':"",
                'decorationDiameter':"",
                'allowSubForDefaultLocation':"1",
                'allowSubForDefaultMethod':"1",
                'decorationUnitsIncluded':"1",
                'decorationUnitsIncludedUom':"COLORS",
                'defaultDecoration':"1",
                'ChargeArray': {'Charge':chargeArr}
            }
            decorationArr.push(decoObject);
        }
        let imprintPriceKey = decorationNameArr.join(',');
        for(let p=0; p<decorationArr.length; p++){
            decorationArr[p].imprintPriceKey = imprintPriceKey;
        }

        let locationObject = {
            "id":"",
            "sourceId":"",
            "decorationsIncluded": "1",
            "defaultLocation": "0",
            "maxDecoration": "1",
            "minDecoration": "1",
            "locationRank": "1",
            "locationId": "",
            "locationName": "",
            "DecorationArray":{
                "Decoration":decorationArr
            }
        }

        let locationArr = [];
        locationArr.push(locationObject);

        let supplierLocationArray = {
            'Location': locationArr
        }
        //return {'SupplierLocationArray':supplierLocationArray};

        projectObj['api'] = "productImport";
        projectObj['sourceId'] = proDetail.id;
        projectObj['source'] = 13;
        projectObj['productType'] = 1;
        projectObj['productTypeName'] = "Product";
        projectObj['productName'] = proDetail.name;
        projectObj['description'] = proDescription;
        projectObj['productId'] = !!proDetail.item_no ? proDetail.item_no : proDetail.id;
        projectObj['vendorName'] = proDetail.vendor_name;
        projectObj['shell'] = proDetail.shell;
        projectObj['assignedUserName'] = proDetail.assigned_user;
        projectObj['production'] = proDetail.production;
        projectObj['package'] = proDetail.package;
        projectObj['coop'] = proDetail.co_op;
        projectObj['rebate'] = proDetail.rebate;
        projectObj['division'] = proDetail.division;
        projectObj['weight'] = proDetail.weight;
        projectObj['taxEnabled'] = proDetail.tax_enabled;
        projectObj['specialPrice'] = proDetail.special_price;
        projectObj['imprintinfo'] = proDetail.imprint;
        projectObj['tariffCode'] = proDetail.tariff_code;
        projectObj['msrp'] = proDetail.msrp;
        projectObj['countryOrigin'] = proDetail.country_origin;
        projectObj['prodStatus'] = "1";
        projectObj['expirationDate'] = expireDate;
        projectObj['poType'] = proDetail.po_type;
        
        projectObj['qbExpenseAccount'] = proDetail.expense_account;
        projectObj['qbIncomeAccount'] = proDetail.income_account;
        projectObj['qbAssetAccount'] = proDetail.asset_account;
        projectObj['ChargeArray'] = {'Charge':[]};
        projectObj['CustomerMarginArray'] = {'CustomerMargin':[]};
        projectObj['DescriptionArray'] = [];
        projectObj['KitArray'] = [];
        projectObj['LocationArray'] = {'Location': []};
        projectObj['ProductCategoryArray'] = catgList;
        projectObj['ProductPartArray'] = {'ProductPart':partArr};
        projectObj['RelatedProductArray'] = {'RelatedProduct':[]};
        projectObj['StoreArray'] = storeList;
        projectObj['SupplierLocationArray'] = supplierLocationArray;
        projectObj['SystemEventArray'] = [];
        projectObj['additionalInfo'] = "";
        projectObj['addonPricing'] = [];
        projectObj['MediaContent'] = mediaContentList;
        projectObj['AvailableCharges'] = "";
        projectObj['DecorationInfo'] = "";
        projectObj['ProductKeywordArray'] = {'ProductKeyword':keywordList};
        projectObj['ProductImprintPartArray'] = {'ProductImprintPart':{[imprintPriceKey]:partArr}};

        return projectObj;
    }

    async productDeleteBySupplier(supplierName:string): Promise<MessageResponseDto>{
        try{
            let productList = [];
            if(supplierName == 'australianapi'){
                await this.writeManager.update(FashionbizProductCode,{},{'status':'1'});
            }
            if(supplierName == 'amrod'){
                await this.writeManager.update(AmrodCategory,{},{'status':1});
            }

            productList = await this.readManager.find(ProductMaster,{'vendor_name':supplierName});
            for(let p=0; p<productList.length; p++){
                await this.deleteProductDetail(productList[p].id);
            }
            return {'status': true, 'message':"Product clear successfully"};
        }catch(error){
            throw new InternalServerErrorException(error); 
        } 
    }

    async productDeleteByIds(productIds:[number]): Promise<MessageResponseDto>{
        try{
            for(let p=0; p<productIds.length; p++){
                await this.deleteProductDetail(productIds[p]);
            }
            return {'status': true, 'message':"Products delete successfully"};
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async deleteProductDetail(productId:number){
        await this.writeManager.delete(ProductImage,{'product_id':productId});
        await this.writeManager.delete(ProductPrice,{'product_id':productId});
        await this.writeManager.delete(ProductOption,{'product_id':productId});
        await this.writeManager.delete(ProductCategory,{'product_id':productId});
        await this.writeManager.delete(ProductBin,{'product_id':productId});
        await this.writeManager.delete(ProductInventory,{'product_id':productId});
        await this.writeManager.delete(ProductKeyword,{'product_id':productId});
        await this.writeManager.delete(ProductSite,{'product_id':productId});
        await this.writeManager.delete(ProductStore,{'product_id':productId});
        await this.writeManager.delete(ProductDecoration,{'product_id':productId});
        await this.writeManager.delete(ProductDecorationCharge,{'product_id':productId});
        await this.writeManager.delete(ProductMaster,{'id':productId});

        return true;
    }

    async checkProductFileStatus(fileStatus:FileStatusDto){
        try{
            let fileDetail = await this.readManager.findOne(UserProductFile,{'file_key':fileStatus.file_key});
            if(fileDetail){
                let response = {
                    'file_upload': fileDetail.file_upload,
                    'status_id': fileDetail.status_id,
                    'total_success_product': 0,
                    'success_record': [],                        
                    'total_duplicate_product': 0,
                    'duplicate_record': [],                        
                    'total_fail_product': 0,
                    'fail_record': [],
                }

                if(fileDetail.file_upload == 1 && fileDetail.status_id > 2){
                    let successRec = fileDetail.success_record;
                    let duplicateRec = fileDetail.duplicate_record;
                    let failRec = fileDetail.fail_record;
                    let rowNoArr = [];
                    let totalSuccRecord = 0;
                    let totalDupRecord = 0;
                    let totalFailRecord = 0;
                    
                    let skip =  (fileStatus.page_no - 1) * fileStatus.limit;
                    let limit = fileStatus.limit;

                    if(fileStatus.tab_type == "success" && successRec){
                        totalSuccRecord = successRec.length;
                        rowNoArr = successRec.slice(skip, limit + skip);
                    }else if(fileStatus.tab_type == "duplicate"){
                        totalDupRecord = duplicateRec.length;
                        rowNoArr = duplicateRec.slice(skip, limit + skip);
                    }else if(fileStatus.tab_type == "fail"){
                        totalFailRecord = failRec.length;
                        rowNoArr = failRec.slice(skip, limit + skip);
                    }

                    if(rowNoArr.length > 0){
                        let fileUrl = await S3.getObject({ Bucket: s3BucketName, Key:fileDetail.file_key}).promise();
                        if(fileUrl.Body){                            
                            let buffers = [];
                            buffers.push(fileUrl.Body);
                            let buffer = Buffer.concat(buffers);
                            let workbook = xlsx.parse(buffer);

                            if(workbook.length > 0 && workbook[0].data && workbook[0].data.length > 0){
                                
                                let startNo = rowNoArr[0];
                                let rawData = [];
                                for(let i=startNo; i<workbook[0].data.length; i++){
                                    let rowIndex = rowNoArr.indexOf(i);
                                    if(rowIndex > -1){
                                        let colValObj = await this.createRespObj(workbook,workbook[0].data[i]);
                                        rawData.push(colValObj);
                                    }
                                    if(rowNoArr.length == rawData.length){
                                        break;
                                    }
                                }

                                let succRawData = [];
                                let dupRawData = [];
                                let failRawData = [];
                                if(fileStatus.tab_type == "success"){
                                    succRawData = rawData;
                                }else if(fileStatus.tab_type == "duplicate"){
                                    dupRawData = rawData;
                                }else if(fileStatus.tab_type == "fail"){
                                    failRawData = rawData;
                                }

                                return {
                                    'file_upload': fileDetail.file_upload,
                                    'status_id': fileDetail.status_id,
                                    'total_success_product': totalSuccRecord,
                                    'success_record': succRawData,
                                    'total_duplicate_product': totalDupRecord,
                                    'duplicate_record': dupRawData,
                                    'total_fail_product': totalFailRecord,
                                    'fail_record': failRawData,                        
                                }
                            }else{
                                return response
                            }
                        }else{
                            throw new HttpException("File detail not available", HttpStatus.NOT_FOUND)
                        }
                    }else{
                        return response
                    }
                }else{
                    return response
                }               
            }else{
                throw new HttpException("File detail not available", HttpStatus.NOT_FOUND);
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async getProductInventory(getInventory:GetInventoryDto): Promise<Object>{
        try{
            let productDetail = await this.readManager.findOne(ProductMaster,{'item_no':getInventory.product_id,'vendor_name':getInventory.supplier_name});
            if(productDetail){
                let proOpt = await this.readManager.find(ProductOption,{'product_id':productDetail.id});
                if(getInventory.supplier_name == "abelanani"){
                    let response = await this.getAbelananiProductInventory(productDetail,getInventory,proOpt);
                    if(response.status && response.data){
                        return {'status':true, 'message':"Inventory detail available", 'data':response.data};
                    }else{
                        return {'status':false, 'message':"Inventory detail not available"};
                    }
                }
                if(getInventory.supplier_name == "giftshowroom"){
                    let response = await this.getGiftshowroomProductInventory(productDetail,getInventory,proOpt);
                    if(response.status && response.data){
                        return {'status':true, 'message':"Inventory detail available", 'data':response.data};
                    }else{
                        return {'status':false, 'message':"Inventory detail not available"};
                    }
                }
                if(getInventory.supplier_name == "kevro"){
                    let response = await this.getKevroProductInventory(productDetail,getInventory,proOpt);
                    if(response.status && response.data){
                        return {'status':true, 'message':"Inventory detail available", 'data':response.data};
                    }else{
                        return {'status':false, 'message':"Inventory detail not available"};
                    }
                }
                if(getInventory.supplier_name == "amrod"){
                    let response = await this.getAmrodProductInventory(productDetail,getInventory,proOpt);
                    if(response.status && response.data){
                        return {'status':true, 'message':"Inventory detail available", 'data':response.data};
                    }else{
                        return {'status':false, 'message':"Inventory detail not available"};
                    }
                }
                if(getInventory.supplier_name == "kmq"){
                    let response = await this.getKmqProductInventory(productDetail,getInventory,proOpt);
                    if(response.status && response.data){
                        return {'status':true, 'message':"Inventory detail available", 'data':response.data};
                    }else{
                        return {'status':false, 'message':"Inventory detail not available"};
                    }
                }
            }else{
                return {'status':false, message:"Product detail not available", data:null};
            }
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async getAbelananiProductInventory(productDetail:ProductMaster,getInventory:GetInventoryDto,proOpt:ProductOption[]){
        try{
            let optArr = [];
            let invtPartArr = [];
            for(let o=0; o<proOpt.length; o++){
                let optDetail = proOpt[o];
                let color:string;
                let size:string;
                if(optDetail.part_id != null){
                    let optPartArr = optDetail.part_id.split('_');
                    if(!optArr.includes(optPartArr[0])){
                        optArr.push(optPartArr[0]);
                        let stockUrl = "https://www.abelanani.com/api/json/product_feed/ABELANANI/product_and_stock/"+optPartArr[0];
                        let stockData = await axios.get(stockUrl);
                        if(stockData.data && stockData.data.products && stockData.data.products.length > 0){
                            for(let v=0; v<stockData.data.products[0].variants.length; v++){
                                let opt = proOpt.find(o => o.part_id === stockData.data.products[0].variants[v].variantCode);
                                let variantData = stockData.data.products[0].variants[v];
                                if(opt){
                                    
                                    let colSizeOpt = await this.createColSize(opt);
                                    let colorCode = colSizeOpt.color;
                                    /* if(colSizeOpt.color == "No Color"){
                                        colorCode = "no-color";
                                    } */
                                    
                                    let optData = {
                                        'color': colSizeOpt.color,
                                        'size': colSizeOpt.size,
                                        //'partId': optDetail.part_id+"-"+colorCode.trim()+"-"+colSizeOpt.size.trim()
                                        'partId': colorCode.trim()+"-"+colSizeOpt.size.trim()
                                    }

                                    let invObje = await this.createOptObj(optData,variantData.variantStockOnHand);                           
                                    invtPartArr.push(invObje);
                                }
                            }                            
                        }
                    }
                }else{
                    let itemNo = productDetail.item_no;
                    if(optDetail.size != "" && optDetail.size != null){
                        itemNo = productDetail.item_no+"-"+optDetail.size;
                    }
                    if(!optArr.includes(itemNo)){
                        optArr.push(itemNo);
                        let stockUrl = "https://www.abelanani.com/api/json/product_feed/ABELANANI/product_and_stock/"+itemNo;
                        let stockData = await axios.get(stockUrl);
                        if(stockData.data && stockData.data.products && stockData.data.products.length > 0){
                            if(stockData.data.products[0].variants.length == 0){

                                let colSizeOpt = await this.createColSize(optDetail);
                                let partId:string;
                                if((optDetail.color == "" || optDetail.color == null) && (optDetail.size == "" || optDetail.size == null)){
                                    partId = "No Color-OSFA";
                                }
                                if((optDetail.color != "" && optDetail.color != null) && (optDetail.size == "" || optDetail.size == null)){
                                    partId = colSizeOpt.color+"-OSFA";
                                }
                                if((optDetail.color == "" || optDetail.color == null) && (optDetail.size != "" && optDetail.size != null)){
                                    partId = "No Color-"+colSizeOpt.size;
                                }
                                let optData = {
                                    'color': colSizeOpt.color,
                                    'size': colSizeOpt.size,
                                    'partId': partId,
                                }
                                let invObje = await this.createOptObj(optData,stockData.data.products[0].productStockOnHand);                           
                                invtPartArr.push(invObje);
                            }
                        }
                    }
                }
            }
            let response = {
                "productId": productDetail.item_no,
                "PartInventoryArray": {
                    "PartInventory": invtPartArr
                }
            }
            return {'status':true, 'data':response};
        }catch(error){
            throw new InternalServerErrorException(error); 
        }
    }

    async getGiftshowroomProductInventory(productDetail:ProductMaster,getInventory:GetInventoryDto,proOpt:ProductOption[]){
        try{
            let invtPartArr = [];
            if(proOpt.length > 0){
                for(let i=0; i<proOpt.length; i++){
                    let opt = proOpt[i];
                    let stockData = await axios.get('http://www.giftshowroom.co.za/rest/service/stock/'+productDetail.item_no);
                    if(stockData.status == 200 && stockData.data){
                        let stockResult = xml2json(stockData.data, {compact: true, spaces: 4});
                        let stockDetail = JSON.parse(stockResult);
                        if(stockDetail.Products && stockDetail.Products.Product && stockDetail.Products.Product.available_stock){
                            let colSizeOpt = await this.createColSize(opt);
                            let colorCode = colSizeOpt.color;
                            /* if(colSizeOpt.color == "No Color"){
                                colorCode = "no-color";
                            } */

                            let partId = colorCode.trim()+"-"+colSizeOpt.size.trim();
                            /* if(opt.part_id != null && opt.part_id != ""){
                                partId = opt.part_id+'-'+colorCode.trim()+"-"+colSizeOpt.size.trim();
                            } */
                            
                            let optData = {
                                'color': colSizeOpt.color,
                                'size': colSizeOpt.size,
                                'partId': partId
                            }
                            let invObje = await this.createOptObj(optData,stockDetail.Products.Product.available_stock._text);                           
                            invtPartArr.push(invObje);
                        }
                    }
                }
            }
            let response = {
                "productId": productDetail.item_no,
                "PartInventoryArray": {
                    "PartInventory": invtPartArr
                }
            }
            return {'status':true, 'data':response};
        }catch(error){
            throw new InternalServerErrorException(error);
        }
    }

    async getKevroProductInventory(productDetail:ProductMaster,getInventory:GetInventoryDto,proOpt:ProductOption[]){
        try{
            let invtPartArr = [];
            await this.kevroService.loginCheck();

            var options = {
                'method': 'POST',
                'url': 'https://wslive.kevro.co.za/StockFeed.asmx/GetFeedByEntityIDAndStockCode',
                'headers': {
                'Authorization': 'Basic c3RrdXNlcjpCQHJyb24wbg==',
                'Content-Type': 'application/json',
                'Cookie': 'ASP.NET_SessionId=5ytt25tpwvl1wf5ibz2i1htw'
                },
                body: JSON.stringify({
                    "entityID": 43084,
                    "username": "wf",
                    "psw": "awgmEi4b/og=",
                    "StockCode":productDetail.item_no,
                    "ReturnType":"json"
                })              
            };

            let stockData = "";
            stockData = await new Promise(function (resolve, reject) {
                request(options, function (error, res, data) {
                    if (!error && res.statusCode == 200) {
                        resolve(data);
                    } else {
                        reject(error);
                    }
                });
            });
            let stock = JSON.parse(stockData);
            let stockDetail = JSON.parse(stock.d.ResponseData);
           
            for(let i=0; i<proOpt.length; i++){
                let opt = proOpt[i];

                let optDetail = stockDetail.find(o => o.StockID.toString() === opt.part_id);
                if(optDetail){
                    let colSizeOpt = await this.createColSize(opt);
                    let colorCode = colSizeOpt.color;
                    /* if(colSizeOpt.color == "No Color"){
                        colorCode = "no-color";
                    } */

                    let partId = colorCode.trim()+"-"+colSizeOpt.size.trim();
                    /* if(opt.part_id != null && opt.part_id != ""){
                        partId = opt.part_id+'-'+colorCode.trim()+"-"+colSizeOpt.size.trim();
                    } */
                    
                    let optData = {
                        'color': colSizeOpt.color,
                        'size': colSizeOpt.size,
                        'partId': partId
                    }
                    let invObje = await this.createOptObj(optData,optDetail.QtyAvailable);                           
                    invtPartArr.push(invObje);
                }
            }
            let response = {
                "productId": productDetail.item_no,
                "PartInventoryArray": {
                    "PartInventory": invtPartArr
                }
            }
            return {'status':true, 'data':response};
        }catch(error){
            throw new InternalServerErrorException(error);
        }
    }

    async getAmrodProductInventory(productDetail:ProductMaster,getInventory:GetInventoryDto,proOpt:ProductOption[]){
        try{
            let proIdIsExist = await this.readManager.find(AmrodProductDetail,{
                'product_id': productDetail.id
            });
            let invtPartArr = [];
            for(let p=0; p<proIdIsExist.length; p++){
                let headers = {
                    'Authorization': 'Amrod type="integrator", token="xZ2AQE3xt9lV5KTN+ewal3imnjmmovYa3g55gqtXoFqpo8uu9Y2UiXg1rVowkrJO0t9J+wO12s95JCqu+Bdl0A=="',
                    'X-AMROD-IMPERSONATE': 'HEW003',
                    'Content-Type': 'application/json'
                }
                let proListRes = await axios.post('https://www.amrod.co.za/v3/api/Catalogue/getProductDetail',{'productId':proIdIsExist[p].amrod_product_id},{
                    headers: headers
                });
                if(proListRes.data.Body && proListRes.data.Body && proListRes.data.Body.StockLevel.Levels){
                    let stockDetail = proListRes.data.Body.StockLevel.Levels;
                    for(let i=0; i<proOpt.length; i++){
                        let opt = proOpt[i];
                        let optDetail = stockDetail.find(o => o.ItemCode.toString() === opt.part_id);
                        
                        if(optDetail){
                            let colSizeOpt = await this.createColSize(opt);
                            let colorCode = colSizeOpt.color;
                            let partId = colorCode.trim()+"-"+colSizeOpt.size.trim();
                            
                            let optData = {
                                'color': colSizeOpt.color,
                                'size': colSizeOpt.size,
                                'partId': partId
                            }
                            let invObje = await this.createOptObj(optData,optDetail.InStock);                           
                            invtPartArr.push(invObje);
                        }
                    }
                }
            }
            let response = {
                "productId": productDetail.item_no,
                "PartInventoryArray": {
                    "PartInventory": invtPartArr
                }
            }
            return {'status':true, 'data':response};
        }catch(error){
            throw new InternalServerErrorException(error);
        }
    }

    async getKmqProductInventory(productDetail:ProductMaster,getInventory:GetInventoryDto,proOpt:ProductOption[]){
        try{
            let stockUrl = 'https://kmq.co.za/api/v1/getSingleProductToken?APIToken=649DC9C0-2818-B022-868C-ADEFE68A1502&productCode='+productDetail.item_no;
            let stockRes = await axios.get(stockUrl);
            
            let invtPartArr = [];
            if(stockRes && stockRes.data){
                let stockDetail = stockRes.data
                for(let i=0; i<proOpt.length; i++){
                    let opt = proOpt[i];
                    let optDetail = stockDetail.find(o => o.ProductCode.replace('/','-').replace('(','').replace(')','') === opt.part_id && o.Colour == opt.color);
                    if(optDetail){
                        let colSizeOpt = await this.createColSize(opt);
                        let colorCode = colSizeOpt.color;
                        /* if(colSizeOpt.color == "No Color"){
                            colorCode = "no-color";
                        } */

                        let partId = colorCode.trim()+"-"+colSizeOpt.size.trim();
                        /* if(opt.part_id != null && opt.part_id != ""){
                            partId = opt.part_id+'-'+colorCode.trim()+"-"+colSizeOpt.size.trim();
                        } */
                        
                        let optData = {
                            'color': colSizeOpt.color,
                            'size': colSizeOpt.size,
                            'partId': partId
                        }
                        let invObje = await this.createOptObj(optData,optDetail.CurrentStock);                           
                        invtPartArr.push(invObje);
                    }
                }
            }
            
            let response = {
                "productId": productDetail.item_no,
                "PartInventoryArray": {
                    "PartInventory": invtPartArr
                }
            }
            return {'status':true, 'data':response};
        }catch(error){
            throw new InternalServerErrorException(error);
        }
    }

    async createOptObj(optData,stockOnHand:string){
        let qty = {
            "uom": "EA",
            "value": stockOnHand
        }

        let locationObj = {
            "inventoryLocationId": "100000",
            "inventoryLocationName": "Main",
            "postalCode": "",
            "country": "",
            "inventoryLocationQuantity":{
                "Quantity": qty
            }
        }
        let inventoryLocationArr = [];
        inventoryLocationArr.push(locationObj)
        let invObje = {
            partId: optData.partId,
            mainPart: false,
            partColor: optData.color,
            labelSize: optData.size,
            partDescription: '',
            quantityAvailable: {
                "Quantity": qty
            },
            InventoryLocationArray: {
                "InventoryLocation":inventoryLocationArr
            }
        }
        return invObje;
    }

    async createColSize(optDetail){
        
        let color = 'No Color'
        if(optDetail.color && optDetail.color != null){
            color = optDetail.color.trim();
        }

        let size = 'OSFA';
        if(optDetail.size && optDetail.size != null){
            size = optDetail.size.trim();
        }
        return {'color':color, 'size':size}
    }

    async changeProductSupplierName(fromSupplier:string,toSupplier:string): Promise<MessageResponseDto>{
        try{
            let productList = await this.readManager.find(ProductMaster,{'vendor_name':fromSupplier});
            if(productList){
                for(let i=0; i<productList.length; i++){
                    await this.writeManager.update(ProductMaster,{'id':productList[i].id},{
                        'vendor_name': toSupplier
                    }); 
                }
            }
            return {"status":true,"message":"Supplier name change successfully"};
        }catch(error){
            throw new InternalServerErrorException(error);
        }
    }
}