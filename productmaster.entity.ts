/*
* This entiry of product master database table
* This file use to save, get, update product detail
* Here defiend product master table column name and tyape with relation of other tables
* This is next js freamwork
*/

import { BaseEntity, Column, Entity, PrimaryGeneratedColumn, OneToMany, JoinColumn, Index } from "typeorm";
import { 
    ProductPrice,
    ProductImage,
    ProductOption,
    ProductCategory,
    ProductQuantity,
    ProductBin,
    ProductInventory,
    ProductKeyword,
    ProductSite,
    ProductStore,
    ProductCopyLog,
    ProductCopyLogDetail,
    ProductDecoration
} from "./index.entity";
@Entity()
export class ProductMaster extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    product_id: number;

    @Column({default:0})
    file_id: number;

    @Index("name-idx")
    @Column({nullable:true})
    name: string;

    @Index("itemno-idx")
    @Column({nullable:true})
    item_no: string;

    @Column({nullable:true})
    slug: string;

    @Index("brand-idx")
    @Column({nullable:true})
    brand: string;

    @Column({type: 'json'})
    description: object;

    @Column({nullable:true})
    sales_status: string;

    @Column({type: 'json'})
    tags: object;

    @Index("vendor-idx")
    @Column({nullable:true})
    vendor_name: string;

    @Column({nullable:true})
    shell: string;

    @Column({nullable:true})
    inhouse_id: string;
   
    @Column({nullable:true})
    assigned_user: string;
   
    @Column({nullable:true})
    production: string;
    
    @Column({nullable:true})
    package: string;
    
    @Column({nullable:true})
    packaging: string;
    
    @Column({nullable:true})
    useful_links: string;
    
    @Column({nullable:true})
    collection: string;
    
    @Column({nullable:true})
    price_range: string;
    
    @Column({nullable:true})
    info: string;
    
    @Column({default:0})
    co_op: number;
    
    @Column({default:0})
    rebate: number;
    
    @Column({nullable:true})
    division: string;
    
    @Column({nullable:true})
    weight: string;
    
    @Column({nullable:true})
    tax_enabled: string;
    
    @Column({nullable:true})
    price: string;
    
    @Column({nullable:true})
    special_price: string;
    
    @Column({nullable:true})
    imprint: string;
    
    @Column({nullable:true})
    tariff_code: string;
    
    @Column({nullable:true})
    msrp: string;
    
    @Column({nullable:true})
    country_origin: string;
    
    @Column({nullable:true})
    kind: string;
    
    @Column({nullable:true})
    status: string;
    
    @Column()
    expiration_date: string;
    
    @Column({nullable:true})
    po_type: string;
    
    @Column({nullable:true})
    type: string;
    
    @Column({nullable:true})
    store_type: string;
    
    @Column({default:0})
    source: string;
    
    @Column({default:0})
    source_id: number;
        
    @Column({nullable:true})
    expense_account: string;
    
    @Column({nullable:true})
    income_account: string;
    
    @Column({nullable:true})
    asset_account: string;
    
    @Column({nullable:true})
    is_move: boolean;

    @Column({nullable:true})
    decoration_name: string;

    @Column({nullable:true})
    decoration_key: string;
    
    @OneToMany(type => ProductImage, ProductImage => ProductImage.product_id)
    @JoinColumn({name:"product_id"})
    imagedetail: ProductImage[];

    @OneToMany(type => ProductPrice, ProductPrice => ProductPrice.product_id)
    @JoinColumn({name:"product_id"})
    pricedetail: ProductPrice[];

    @OneToMany(type => ProductOption, ProductOption => ProductOption.product_id)
    @JoinColumn({name:"product_id"})
    optiondetail: ProductOption[];

    @OneToMany(type => ProductCategory, ProductCategory => ProductCategory.product_id)
    @JoinColumn({name:"product_id"})
    categorydetail: ProductCategory[];

    @OneToMany(type => ProductQuantity, ProductQuantity => ProductQuantity.product_id)
    @JoinColumn({name:"product_id"})
    quantitydetail: ProductQuantity[];

    @OneToMany(type => ProductBin, ProductBin => ProductBin.product_id)
    @JoinColumn({name:"product_id"})
    bindetail: ProductBin[];

    @OneToMany(type => ProductInventory, ProductInventory => ProductInventory.product_id)
    @JoinColumn({name:"product_id"})
    inventorydetail: ProductInventory[];

    @OneToMany(type => ProductKeyword, ProductKeyword => ProductKeyword.product_id)
    @JoinColumn({name:"product_id"})
    keyworddetail: ProductKeyword[];

    @OneToMany(type => ProductSite, ProductSite => ProductSite.product_id)
    @JoinColumn({name:"product_id"})
    sitedetail: ProductSite[];

    @OneToMany(type => ProductStore, ProductStore => ProductStore.product_id)
    @JoinColumn({name:"product_id"})
    storedetail: ProductStore[];

    @OneToMany(type => ProductCopyLog, ProductCopyLog => ProductCopyLog.product_id)
    @JoinColumn({name:"product_id"})
    productlog: ProductCopyLog[];

    @OneToMany(type => ProductCopyLogDetail, ProductCopyLogDetail => ProductCopyLogDetail.product_id)
    @JoinColumn({name:"product_id"})
    productlogdetail: ProductCopyLogDetail[];

    @OneToMany(type => ProductDecoration, ProductDecoration => ProductDecoration.product_id)
    @JoinColumn({name:"product_id"})
    productdecorationdetail: ProductDecoration[];
}